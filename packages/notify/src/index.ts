import type { Pool } from "pg";
import { Resend } from "resend";
import type { NotificationType } from "@scanpal/shared";
import { notificationTypes } from "@scanpal/shared";

export type NotifyDeps = {
  db: Pool;
  resendApiKey?: string;
  resendFrom?: string;
  appUrl?: string;
  log?: (line: string) => void;
};

export type NotifyInput = {
  type: NotificationType;
  teamId: string;
  /** Scan-id voor scan-scoped types, site-id voor site-scoped types. */
  entityId: string;
  /** Incident-id voor herhaalbaarheid (site-down: `uptime_state_changed_at`). */
  incidentId?: string;
  payload?: Record<string, unknown>;
};

export type NotifyResult = {
  recipients: number;
  inserted: number;
  deduped: number;
  emailsSent: number;
  emailsFailed: number;
  /** Outbox-rijen voor enabled team-webhooks (plan 15, async bezorgd). */
  outboxQueued: number;
};

/** Default per type (plan 13, besluit): alleen scan_done staat uit. */
export const defaultEnabled: Record<NotificationType, boolean> = {
  scan_done: false,
  score_drop: true,
  site_down: true,
  site_recovered: true,
  critical_finding: true,
  credit_skip: true,
  scan_failed: true,
  webhook_disabled: true,
  payment_failed: true,
  domain_alert: true,
};

type Template = {
  title(payload: Record<string, unknown>): string;
  subject(payload: Record<string, unknown>): string;
  body(payload: Record<string, unknown>): string;
  link(entityId: string): string;
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function num(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.round(value))
    : "?";
}

const SITE_NAME = (p: Record<string, unknown>): string =>
  str(p.site_name, "de site");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const templates: Record<NotificationType, Template> = {
  credit_skip: {
    title: () => "Scan overgeslagen",
    subject: (p) => `Geplande scan overgeslagen: ${SITE_NAME(p)}`,
    body: (p) =>
      `De geplande scan voor ${SITE_NAME(p)} is overgeslagen omdat de maandelijkse scan-limiet is bereikt. Het schema blijft actief; de volgende scan volgt gewoon.`,
    link: (id) => `/sites/${id}`,
  },
  scan_failed: {
    title: () => "Scan mislukt",
    subject: (p) => `Geplande scan mislukt: ${SITE_NAME(p)}`,
    body: (p) =>
      `De geplande scan voor ${SITE_NAME(p)} is mislukt (site mogelijk niet bereikbaar). De volgende geplande run volgt automatisch.`,
    link: (id) => `/scans/${id}`,
  },
  score_drop: {
    title: () => "Score gedaald",
    subject: (p) => `Score gedaald: ${SITE_NAME(p)}`,
    body: (p) =>
      `De scan-score van ${SITE_NAME(p)} is gedaald van ${num(p.previous_score)} naar ${num(p.new_score)}. Bekijk de bevindingen voor de oorzaak.`,
    link: (id) => `/scans/${id}`,
  },
  scan_done: {
    title: () => "Scan voltooid",
    subject: (p) => `Scan voltooid: ${SITE_NAME(p)}`,
    body: (p) =>
      `De scan van ${SITE_NAME(p)} is voltooid met een score van ${num(p.score)}/100.`,
    link: (id) => `/scans/${id}`,
  },
  critical_finding: {
    title: () => "Kritieke bevinding",
    subject: (p) => `Kritieke bevinding: ${SITE_NAME(p)}`,
    body: (p) =>
      `De scan van ${SITE_NAME(p)} heeft ${num(p.count)} kritieke bevinding(en). Bekijk ze zo snel mogelijk.`,
    link: (id) => `/scans/${id}`,
  },
  site_down: {
    title: () => "Site down",
    subject: (p) => `Site down: ${SITE_NAME(p)}`,
    body: (p) =>
      `${SITE_NAME(p)} is niet bereikbaar (twee opeenvolgende mislukte checks). Controleer de server.`,
    link: (id) => `/uptime/${id}`,
  },
  site_recovered: {
    title: () => "Site hersteld",
    subject: (p) => `Site hersteld: ${SITE_NAME(p)}`,
    body: (p) => `${SITE_NAME(p)} is weer bereikbaar.`,
    link: (id) => `/uptime/${id}`,
  },
  webhook_disabled: {
    title: () => "Webhook uitgeschakeld",
    subject: (p) => `Webhook uitgeschakeld: ${str(p.webhook_name, "onbekend")}`,
    body: (p) =>
      `De webhook "${str(p.webhook_name, "onbekend")}" is uitgeschakeld na 5 mislukte leveringen. Controleer het endpoint en zet de webhook weer aan.`,
    link: () => `/settings/webhooks`,
  },
  payment_failed: {
    title: () => "Betalingsfout",
    subject: () => "Betalingsfout — actie vereist",
    body: (p) =>
      `De betaling voor je abonnement is mislukt (${str(p.amount_due, "bedrag onbekend")}). Stripe probeert het automatisch opnieuw; werk ondertussen je betaalmethode bij om onderbreking te voorkomen.`,
    link: () => `/billing`,
  },
  domain_alert: {
    title: (p) => `Domein-alert: ${str(p.field, "onbekend")}`,
    subject: (p) => `Domein-alert: ${SITE_NAME(p)} — ${str(p.field, "wijziging")}`,
    body: (p) =>
      `Domein-wijziging voor ${SITE_NAME(p)}: ${str(p.summary, "er is een afwijking gedetecteerd")}. Controleer de domein-kaart op de site-detailpagina.`,
    link: (id) => `/sites/${id}`,
  },
};

function webhookDedupKey(input: NotifyInput, webhookId: string): string {
  return `${input.type}:${webhookId}:${input.entityId}:${input.incidentId ?? ""}`;
}

function dedupKey(input: NotifyInput, userId: string): string {
  return `${input.type}:${userId}:${input.entityId}:${input.incidentId ?? ""}`;
}

function emailHtml(title: string, body: string, appUrl: string, link: string): string {
  const safeBody = escapeHtml(body);
  const href = `${appUrl.replace(/\/$/, "")}${link}`;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1e293b;">
      <h1 style="font-size: 20px; margin: 0 0 12px;">${escapeHtml(title)}</h1>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">${safeBody}</p>
      <a href="${href}" style="display: inline-block; background: #2dd4bf; color: #0f172a; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
        Bekijk in ScanPal
      </a>
    </div>
  `;
}

/**
 * Notificatiehub (plan 13): één aanroep per event → ontvangers + voorkeuren
 * opzoeken, dedup-check via de unieke `dedup_key` (dubbele sends bij retries
 * onmogelijk), in-app rij aanmaken en e-mail versturen (Resend) bij enabled.
 * Waarde-/drempelbeslissingen (score-daling, kritiek) blijven bij de caller.
 */
export function createNotifier(deps: NotifyDeps) {
  const log = deps.log ?? (() => {});
  const resendFrom = deps.resendFrom ?? "ScanPal <no-reply@scanpal.dev>";
  const appUrl = deps.appUrl ?? "http://localhost:3000";

  return async function notify(input: NotifyInput): Promise<NotifyResult> {
    if (!notificationTypes.includes(input.type)) {
      throw new Error(`Onbekend notificatie-type: ${String(input.type)}`);
    }

    const result: NotifyResult = {
      recipients: 0,
      inserted: 0,
      deduped: 0,
      emailsSent: 0,
      emailsFailed: 0,
      outboxQueued: 0,
    };

    const recipients = await deps.db.query<{
      user_id: string;
      email: string;
      pref_enabled: boolean | null;
    }>(
      `select u.id as user_id, u.email, p.enabled as pref_enabled
       from memberships m
       join users u on u.id = m.user_id
       left join notification_preferences p
         on p.user_id = u.id and p.type = $2
       where m.team_id = $1 and m.status = 'accepted'`,
      [input.teamId, input.type],
    );
    result.recipients = recipients.rowCount ?? 0;

    const template = templates[input.type];
    const payload = input.payload ?? {};
    const title = template.title(payload);
    const body = template.body(payload);
    const link = template.link(input.entityId);
    const html = emailHtml(title, body, appUrl, link);

    for (const row of recipients.rows) {
      const enabled = row.pref_enabled ?? defaultEnabled[input.type];
      if (!enabled) continue;

      const inserted = await deps.db.query<{ id: string }>(
        `insert into notifications
           (team_id, user_id, type, title, body, link, payload, dedup_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (dedup_key) do nothing
         returning id`,
        [
          input.teamId,
          row.user_id,
          input.type,
          title,
          body,
          link,
          JSON.stringify(payload),
          dedupKey(input, row.user_id),
        ],
      );

      if (inserted.rowCount === 0) {
        result.deduped += 1;
        continue;
      }
      result.inserted += 1;

      try {
        await sendEmail(deps.resendApiKey, resendFrom, row.email, template.subject(payload), html);
        result.emailsSent += 1;
      } catch (err) {
        result.emailsFailed += 1;
        log(`notify: e-mail naar ${row.email} mislukt: ${String(err)}`);
      }
    }

    // Webhook-kanaal (plan 15): enabled team-webhooks die dit event
    // selecteren krijgen een outbox-rij (pending) — bezorging is async via
    // de deliverer. Per-user voorkeuren zijn bewust niet van invloed.
    const webhooks = await deps.db.query<{ id: string }>(
      `select id from webhooks
        where team_id = $1 and active = true and $2 = any(events)`,
      [input.teamId, input.type],
    );
    for (const webhook of webhooks.rows) {
      const inserted = await deps.db.query(
        `insert into webhook_deliveries (webhook_id, event, payload, dedup_key)
         values ($1, $2, $3, $4)
         on conflict (dedup_key) do nothing`,
        [
          webhook.id,
          input.type,
          JSON.stringify(input.payload ?? {}),
          webhookDedupKey(input, webhook.id),
        ],
      );
      if ((inserted.rowCount ?? 0) > 0) result.outboxQueued += 1;
    }

    return result;
  };
}

async function sendEmail(
  apiKey: string | undefined,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!apiKey) {
    console.warn("RESEND_API_KEY ontbreekt — notificatiemail niet verstuurd");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    throw new Error(`Resend-fout: ${error.message}`);
  }
}

export * from "./webhook-secret";
export * from "./webhook-security";
export * from "./webhook-deliverer";
