import "server-only";

import type { Pool, PoolClient } from "pg";
import type { ScanFrequency } from "@scanpal/shared";
import {
  emitScanFinishedNotifications,
  finishScan,
  refundCredit,
  setSiteScanState,
  spendCredit,
  type ScanRowWithMeta,
} from "@scanpal/scan-core";
import { next09Utc } from "./schedule";
import { ScanError } from "@scanpal/scan-core";

export { emitScanFinishedNotifications, finishScan, ScanError };
export type { FinishScanInput, ScanNotificationSender, ScanRowWithMeta } from "@scanpal/scan-core";

export type ScanHistoryRow = {
  id: string;
  site_id: string;
  site_url: string;
  site_label: string | null;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  score: number | null;
  active_tests: boolean;
  trigger: "manual" | "schedule" | "deploy";
  scheduled_for: Date | null;
  created_at: Date;
  completed_at: Date | null;
};

export type CancelScanErrorCode = "not_found" | "not_cancelable";

export class CancelScanError extends Error {
  constructor(
    public code: CancelScanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CancelScanError";
  }
}

const ACTIVE_SCAN_STATUSES = "('queued', 'running')";

export async function listScanHistory(
  db: Pool,
  input: { teamId: string; siteId?: string },
): Promise<ScanHistoryRow[]> {
  const params: unknown[] = [input.teamId];
  let siteFilter = "";
  if (input.siteId) {
    params.push(input.siteId);
    siteFilter = `and sc.site_id = $2`;
  }

  const result = await db.query(
    `select sc.id, sc.site_id, s.url as site_url, s.label as site_label,
            sc.status, sc.progress, sc.score, sc.active_tests, sc.trigger,
            sc.scheduled_for, sc.created_at, sc.completed_at
     from scans sc
     join sites s on s.id = sc.site_id
     where s.team_id = $1 ${siteFilter}
     order by sc.created_at desc
     limit 100`,
    params,
  );
  return result.rows as ScanHistoryRow[];
}

export type CreateScanOutcome = {
  scan: ScanRowWithMeta;
  completed: false;
};

/**
 * Start een directe scan (trigger='manual' of 'deploy'): site-ownership-check,
 * overlap-check, credit-afschrijving (atomair) en een `queued` scans-rij
 * aanmaken. De webapp enqueue daarna `scan.dispatcher` en antwoordt 202 —
 * de worker-pipeline voert de scan uit (plan 27, besluit 7). Geen inline
 * probe meer. Plan 58: on-deploy-webhooks starten met `trigger: "deploy"`.
 */
export async function createManualScan(
  db: Pool,
  input: {
    teamId: string;
    siteId: string;
    activeTests?: boolean;
    trigger?: "manual" | "deploy";
  },
): Promise<CreateScanOutcome> {
  const client = await db.connect();
  let scan: ScanRowWithMeta | null = null;

  try {
    await client.query("begin");

    const site = await client.query(
      "select url from sites where id = $1 and team_id = $2",
      [input.siteId, input.teamId],
    );
    if (site.rowCount === 0) {
      await client.query("rollback");
      throw new ScanError("not_found", "Site niet gevonden");
    }

    const active = await client.query(
      `select 1 from scans where site_id = $1 and status in ${ACTIVE_SCAN_STATUSES} limit 1`,
      [input.siteId],
    );
    if (active.rowCount !== 0) {
      await client.query("rollback");
      throw new ScanError("overlap", "Er draait al een scan voor deze site");
    }

    const activeTests = input.activeTests ?? false;
    const trigger = input.trigger ?? "manual";
    const inserted = await client.query(
      `insert into scans (site_id, status, trigger, active_tests)
       values ($1, 'queued', $2, $3)
       returning *`,
      [input.siteId, trigger, activeTests],
    );
    scan = inserted.rows[0] as ScanRowWithMeta;

    await setSiteScanState(client, input.siteId, {
      scanId: scan.id,
      status: "queued",
    });

    await spendCredit(client, {
      teamId: input.teamId,
      reason: "scan",
      scanId: scan.id,
    });

    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie is mogelijk al beëindigd — negeren
    }
    client.release();
    throw err;
  }
  client.release();

  if (!scan) throw new ScanError("not_found", "Site niet gevonden");
  return { scan, completed: false };
}

/**
 * Cancel een scan (plan 19): alleen `queued`/`running` → `canceled`. De rij
 * blijft behouden voor historie; `completed_at` blijft null; de site-status
 * wordt bijgewerkt (score behouden) en de credit wordt terugbetaald
 * (idempotent). Authz: scan JOIN sites JOIN team — geen match → not_found
 * (geen existence-leak). `for update` lockt tegen gelijktijdige finish.
 */
export async function cancelScan(
  db: Pool,
  input: { teamId: string; scanId: string },
): Promise<ScanRowWithMeta> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const result = await client.query(
      `select s.id, s.site_id, s.status
       from scans s
       join sites st on st.id = s.site_id
       where s.id = $1 and st.team_id = $2
       for update`,
      [input.scanId, input.teamId],
    );
    if (result.rowCount === 0) {
      await client.query("rollback");
      throw new CancelScanError("not_found", "Scan niet gevonden");
    }
    const scan = result.rows[0] as { id: string; site_id: string; status: string };

    if (scan.status !== "queued" && scan.status !== "running") {
      await client.query("rollback");
      throw new CancelScanError("not_cancelable", "Scan is al afgerond");
    }

    const updated = await client.query(
      "update scans set status = 'canceled' where id = $1 returning *",
      [input.scanId],
    );

    await setSiteScanState(client, scan.site_id, {
      scanId: input.scanId,
      status: "canceled",
    });

    await refundCredit(client, {
      teamId: input.teamId,
      scanId: input.scanId,
    });

    await client.query("commit");
    return updated.rows[0] as ScanRowWithMeta;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie is mogelijk al beëindigd — negeren
    }
    client.release();
    throw err;
  }
  client.release();
}

/**
 * Zet het schema (none/daily/weekly) voor een site en berekent next_scan_at.
 * Werkt alleen op sites van het eigen team.
 */
export async function setSiteSchedule(
  db: Pool,
  input: {
    teamId: string;
    siteId: string;
    frequency: ScanFrequency;
    now?: Date;
  },
): Promise<{ siteId: string; scan_frequency: ScanFrequency; next_scan_at: Date | null }> {
  const next =
    input.frequency === "none" ? null : next09Utc(input.now ?? new Date());

  const result = await db.query(
    `update sites
        set scan_frequency = $1, next_scan_at = $2
      where id = $3 and team_id = $4
      returning id, scan_frequency, next_scan_at`,
    [input.frequency, next, input.siteId, input.teamId],
  );

  if (result.rowCount === 0) {
    throw new ScanError("not_found", "Site niet gevonden");
  }
  return result.rows[0] as {
    siteId: string;
    scan_frequency: ScanFrequency;
    next_scan_at: Date | null;
  };
}

export async function getPreviousScanScore(
  client: PoolClient,
  siteId: string,
): Promise<number | null> {
  const result = await client.query(
    `select score from scans
      where site_id = $1 and status = 'completed' and score is not null
      order by created_at desc
      limit 1`,
    [siteId],
  );
  return result.rowCount ? (result.rows[0].score as number) : null;
}

export type ScanTrendPointRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  score: number | null;
  category_scores: {
    http: number | null;
    seo: number | null;
    aeo: number | null;
    github: number | null;
  } | null;
  trigger: "manual" | "schedule";
  created_at: Date;
  completed_at: Date | null;
};

export type ScanTrendSiteSummary = {
  id: string;
  url: string;
  github_repo: string | null;
  github_webhook_configured: boolean;
  label: string | null;
  public_status_slug: string | null;
  last_scan_score: number | null;
  last_scanned_at: Date | null;
};

/**
 * Feature 10 — score-trend per site. Haalt de site op (team-scoped,
 * geen existence-leak bij een andere team) en de voltooide/failed scans
 * in chronologische volgorde (oud → nieuw). `limit` capped op 100.
 * `failed`-scans blijven zichtbaar (score null); `canceled`/`running`
 * vallen weg — ze dragen niet bij aan een trend.
 */
export async function getScanTrend(
  db: Pool,
  input: { teamId: string; siteId: string; limit?: number },
): Promise<{ site: ScanTrendSiteSummary | null; points: ScanTrendPointRow[] }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  const siteResult = await db.query(
    `select id, url, github_repo, label, public_status_slug,
       (github_webhook_secret is not null) as github_webhook_configured,
       last_scan_score, last_scanned_at
       from sites
      where id = $1 and team_id = $2`,
    [input.siteId, input.teamId],
  );
  if (siteResult.rowCount === 0) {
    return { site: null, points: [] };
  }
  const site = siteResult.rows[0] as ScanTrendSiteSummary;

  const result = await db.query(
    `select id, status, score, category_scores, trigger, created_at, completed_at
       from scans
      where site_id = $1 and status in ('completed', 'failed')
      order by created_at asc
      limit $2`,
    [input.siteId, limit],
  );
  return { site, points: result.rows as ScanTrendPointRow[] };
}

export function toScanJson(scan: ScanRowWithMeta) {
  return {
    ...scan,
    progress_details: scan.progress_details,
    scheduled_for: scan.scheduled_for ? scan.scheduled_for.toISOString() : null,
    created_at: scan.created_at.toISOString(),
    completed_at: scan.completed_at ? scan.completed_at.toISOString() : null,
  };
}