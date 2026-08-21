import "server-only";

import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { ThreatHoneypotRow, ThreatRuleRow } from "@scanpal/db";
import type {
  ThreatEvent,
  ThreatEventsQuery,
  ThreatHoneypotView,
  ThreatOverview,
  ThreatRuleKey,
} from "@scanpal/shared";
import { env } from "@/lib/env";
import type { RuleMatch, ThreatHit } from "@/lib/threat-rules";

type HoneypotRow = ThreatHoneypotRow & { site_url: string; site_label: string | null };

/** Een team-site die nog geen honeypot heeft — voedt de "maak honeypot"-actie in het paneel. */
export type ThreatCreatableSite = {
  site_id: string;
  site_url: string;
  site_label: string | null;
};

function toHoneypotView(row: HoneypotRow): ThreatHoneypotView {
  return {
    site_id: row.site_id,
    site_url: row.site_url,
    site_label: row.site_label,
    honeypot_id: row.id,
    enabled: row.enabled,
    url: honeypotUrlFor(row.token),
    path: honeypotPathFor(row.token),
    hit_count: row.hit_count,
    created_at: row.created_at.toISOString(),
  };
}

export function honeypotPathFor(token: string): string {
  return `/h/${token}`;
}

export function honeypotUrlFor(token: string): string {
  const base = (env.honeypotBaseUrl ?? env.appUrl).replace(/\/+$/, "");
  return `${base}${honeypotPathFor(token)}`;
}

export function honeypotSnippet(token: string): { html: string; url: string } {
  const url = honeypotUrlFor(token);
  return {
    url,
    html: [
      `<!-- ScanPal honeypot (verborgen — niet verwijderen) -->`,
      `<a href="${url}" rel="nofollow" aria-hidden="true" style="display:none">.</a>`,
    ].join("\n"),
  };
}

/** Honeypot opzoeken op token (publieke route); team_id via site-join. */
export async function getHoneypotByToken(
  db: Pool,
  token: string,
): Promise<ThreatHoneypotRow | null> {
  const result = await db.query<ThreatHoneypotRow>(
    `select h.id, h.site_id, s.team_id, h.token, h.enabled, h.hit_count, h.created_at
     from threat_honeypots h
     join sites s on s.id = h.site_id
     where h.token = $1`,
    [token],
  );
  return result.rowCount ? result.rows[0] : null;
}

/**
 * Fast-path bij een honeypot-hit: event inserten + hit_count ophogen, of
 * dedupen (zelfde honeypot + IP binnen 10 seconden → alleen counter, geen
 * event) zodat een hammerende bot de tabel niet volschrijft. Retourneert
 * null als de hit gededupliceerd is.
 */
export async function recordHoneypotHit(
  db: Pool,
  honeypot: ThreatHoneypotRow,
  hit: ThreatHit,
): Promise<{ eventId: string | null }> {
  if (hit.ip) {
    const recent = await db.query(
      `select id from threat_events
       where honeypot_id = $1 and ip = $2::inet
         and created_at > now() - interval '10 seconds'
       limit 1`,
      [honeypot.id, hit.ip],
    );
    if (recent.rowCount) {
      await db.query(
        "update threat_honeypots set hit_count = hit_count + 1 where id = $1",
        [honeypot.id],
      );
      return { eventId: null };
    }
  }

  const inserted = await db.query<{ id: string }>(
    `insert into threat_events (team_id, site_id, honeypot_id, kind, risk, path, ip, user_agent, payload)
     values ($1, $2, $3, 'hit', 'low', $4, $5::inet, $6, '{}'::jsonb)
     returning id`,
    [
      honeypot.team_id,
      honeypot.site_id,
      honeypot.id,
      hit.path,
      hit.ip,
      hit.userAgent,
    ],
  );
  await db.query(
    "update threat_honeypots set hit_count = hit_count + 1 where id = $1",
    [honeypot.id],
  );
  return { eventId: inserted.rows[0]?.id ?? null };
}

/** De analyse-match op het event zetten (kind hit → pattern). */
export async function markPatternEvent(
  db: Pool,
  eventId: string,
  match: RuleMatch,
): Promise<void> {
  await db.query(
    `update threat_events
     set kind = 'pattern', risk = $2, matched_rule = $3,
         payload = jsonb_build_object('matched_rules', jsonb_build_array($3))
     where id = $1`,
    [eventId, match.risk, match.rule_key],
  );
}

export async function listThreatRules(db: Pool): Promise<ThreatRuleRow[]> {
  const result = await db.query<ThreatRuleRow>(
    `select id, name, rule_key, risk, description, enabled
     from threat_rules order by name`,
  );
  return result.rows;
}

function toEvent(row: {
  id: string;
  team_id: string;
  site_id: string;
  honeypot_id: string;
  kind: ThreatEvent["kind"];
  risk: ThreatEvent["risk"];
  path: string;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  asn: string | null;
  matched_rule: ThreatEvent["matched_rule"];
  payload: Record<string, unknown>;
  created_at: Date;
}): ThreatEvent {
  return {
    id: row.id,
    team_id: row.team_id,
    site_id: row.site_id,
    honeypot_id: row.honeypot_id,
    kind: row.kind,
    risk: row.risk,
    path: row.path,
    ip: row.ip,
    user_agent: row.user_agent,
    country: row.country,
    asn: row.asn,
    matched_rule: row.matched_rule,
    payload: row.payload,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Team-sites zonder honeypot: geeft het paneel de sites waarvoor de klant nog
 * een detectie-route kan aanmaken (via POST /api/sites/[id]/honeypot). Team-scoped,
 * consistent met listThreatOverviews (geen workspace-filter).
 */
export async function listSitesWithoutHoneypot(
  db: Pool,
  teamId: string,
): Promise<ThreatCreatableSite[]> {
  const result = await db.query<ThreatCreatableSite>(
    `select s.id as site_id, s.url as site_url, s.label as site_label
     from sites s
     where s.team_id = $1
       and not exists (select 1 from threat_honeypots h where h.site_id = s.id)
     order by s.created_at desc`,
    [teamId],
  );
  return result.rows;
}

/** Overzicht per site voor het threats-paneel (team-scoped). */
export async function listThreatOverviews(
  db: Pool,
  teamId: string,
): Promise<ThreatOverview[]> {
  const honeypots = await db.query<HoneypotRow>(
    `select h.id, h.site_id, s.team_id, h.token, h.enabled, h.hit_count,
            h.created_at, s.url as site_url, s.label as site_label
     from threat_honeypots h
     join sites s on s.id = h.site_id
     where s.team_id = $1
     order by h.created_at desc`,
    [teamId],
  );
  if (honeypots.rowCount === 0) return [];

  const ids = honeypots.rows.map((r) => r.id);

  const [lastEvents, highRisk, active] = await Promise.all([
    db.query<{
      id: string;
      team_id: string;
      site_id: string;
      honeypot_id: string;
      kind: ThreatEvent["kind"];
      risk: ThreatEvent["risk"];
      path: string;
      ip: string | null;
      user_agent: string | null;
      country: string | null;
      asn: string | null;
      matched_rule: ThreatEvent["matched_rule"];
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `select distinct on (e.honeypot_id)
              e.id, e.team_id, e.site_id, e.honeypot_id, e.kind, e.risk,
              e.path, e.ip, e.user_agent, e.country, e.asn, e.matched_rule,
              e.payload, e.created_at
       from threat_events e
       where e.honeypot_id = any($1::uuid[])
       order by e.honeypot_id, e.created_at desc`,
      [ids],
    ),
    db.query<{ honeypot_id: string; n: number }>(
      `select honeypot_id, count(*)::int as n from threat_events
       where honeypot_id = any($1::uuid[]) and risk in ('high', 'critical')
       group by honeypot_id`,
      [ids],
    ),
    db.query<{ honeypot_id: string; rule_key: string }>(
      `select distinct honeypot_id, matched_rule as rule_key from threat_events
       where honeypot_id = any($1::uuid[]) and matched_rule is not null
         and created_at > now() - interval '24 hours'`,
      [ids],
    ),
  ]);

  const lastByHoneypot = new Map(lastEvents.rows.map((e) => [e.honeypot_id, toEvent(e)]));
  const highByHoneypot = new Map(highRisk.rows.map((r) => [r.honeypot_id, r.n]));
  const activeByHoneypot = new Map<string, ThreatRuleKey[]>();
  for (const row of active.rows) {
    const list = activeByHoneypot.get(row.honeypot_id) ?? [];
    if (row.rule_key) list.push(row.rule_key as ThreatRuleKey);
    activeByHoneypot.set(row.honeypot_id, list);
  }

  return honeypots.rows.map((row) => ({
    site: toHoneypotView(row),
    last_event: lastByHoneypot.get(row.id) ?? null,
    high_risk_count: highByHoneypot.get(row.id) ?? 0,
    active_patterns: activeByHoneypot.get(row.id) ?? [],
  }));
}

/** Gefilterde events (team-scoped, paginated). */
export async function listThreatEvents(
  db: Pool,
  teamId: string,
  query: ThreatEventsQuery,
): Promise<{ events: ThreatEvent[]; total: number }> {
  const conditions: string[] = ["s.team_id = $1"];
  const params: unknown[] = [teamId];

  if (query.site_id) {
    params.push(query.site_id);
    conditions.push(`e.site_id = $${params.length}`);
  }
  if (query.risk) {
    params.push(query.risk);
    conditions.push(`e.risk = $${params.length}`);
  }
  if (query.kind) {
    params.push(query.kind);
    conditions.push(`e.kind = $${params.length}`);
  }

  const where = conditions.join(" and ");
  const [rows, count] = await Promise.all([
    db.query<{
      id: string;
      team_id: string;
      site_id: string;
      honeypot_id: string;
      kind: ThreatEvent["kind"];
      risk: ThreatEvent["risk"];
      path: string;
      ip: string | null;
      user_agent: string | null;
      country: string | null;
      asn: string | null;
      matched_rule: ThreatEvent["matched_rule"];
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `select e.id, e.team_id, e.site_id, e.honeypot_id, e.kind, e.risk,
              e.path, e.ip, e.user_agent, e.country, e.asn, e.matched_rule,
              e.payload, e.created_at
       from threat_events e
       join sites s on s.id = e.site_id
       where ${where}
       order by e.created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, query.page_size, (query.page - 1) * query.page_size],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n
       from threat_events e
       join sites s on s.id = e.site_id
       where ${where}`,
      params,
    ),
  ]);

  return {
    events: rows.rows.map(toEvent),
    total: count.rows[0]?.n ?? 0,
  };
}

/**
 * Honeypot aanzetten/uitzetten + token-rotatie (Pro-gated in de route).
 * Null als de site niet van het team is. De klant krijgt de install-snippet.
 */
export async function setHoneypot(
  db: Pool,
  teamId: string,
  siteId: string,
  input: { enabled: boolean; rotateToken: boolean },
): Promise<{ view: ThreatHoneypotView; snippet: { html: string; url: string } } | null> {
  const site = await db.query(
    "select id from sites where id = $1 and team_id = $2",
    [siteId, teamId],
  );
  if (site.rowCount === 0) return null;

  const newToken = randomBytes(32).toString("base64url");
  await db.query(
    `insert into threat_honeypots (site_id, token, enabled)
     values ($1, $2, $3)
     on conflict (site_id) do update
       set enabled = excluded.enabled,
           token = case when $4 then $5 else threat_honeypots.token end`,
    [siteId, newToken, input.enabled, input.rotateToken, newToken],
  );

  const row = await db.query<HoneypotRow>(
    `select h.id, h.site_id, s.team_id, h.token, h.enabled, h.hit_count,
            h.created_at, s.url as site_url, s.label as site_label
     from threat_honeypots h
     join sites s on s.id = h.site_id
     where h.site_id = $1 and s.team_id = $2`,
    [siteId, teamId],
  );
  if (row.rowCount === 0) return null;

  const view = toHoneypotView(row.rows[0]);
  return { view, snippet: honeypotSnippet(row.rows[0].token) };
}
