import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import {
  webhookEnvelopeSchema,
  WEBHOOK_MAX_PAYLOAD_BYTES,
  type NotificationType,
} from "@scanpal/shared";
import { decryptWebhookSecret } from "./webhook-secret";
import { isUrlAllowed } from "./webhook-security";

/**
 * Outbound webhook-deliverer (plan 15, besluit 2/5/6/7): pollt due
 * `pending|failed`-rijen uit de outbox, verrijkt de payload met
 * site/scan-context, HMAC-SHA256-signering, POST met 10s-timeout en
 * SSRF-guard (incl. DNS-resolutie + redirect-stappen). Na max 5 mislukte
 * pogingen (backoff 1m..2h) gaat de webhook uit + `webhook_disabled`-
 * notificatie. Bepaalde 4xx (400/401/403/404/410) en ongeldige URLs zijn
 * blijvend → `rejected` zonder retry.
 *
 * Pre-BullMQ draait dit als loop in de scheduler (pattern uptime-poller);
 * na Fase 3 wordt het de BullMQ-queue `webhook.deliver`. Het outbox-contract
 * verandert daarbij niet.
 */

export type WebhookDelivererDeps = {
  db: Pool;
  /** 32-byte base64 AES-GCM-sleutel (`WEBHOOK_SECRET_KEY`) voor decryption. */
  secretKey: string;
  log?: (line: string) => void;
  now?: () => Date;
  fetchFn?: typeof fetch;
  notify?: (input: {
    type: NotificationType;
    teamId: string;
    entityId: string;
    incidentId?: string;
    payload?: Record<string, unknown>;
  }) => Promise<unknown> | unknown;
  maxAttempts?: number;
};

export type DeliveryOutcome =
  | { status: "ok" }
  | { status: "rejected"; reason?: string }
  | { status: "failed" }
  | { status: "disabled" }
  | { status: "not-found" };

export type DeliverDueResult = {
  attempted: number;
  delivered: number;
  rejected: number;
  failed: number;
  disabled: number;
};

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
export const MAX_ATTEMPTS = 5;
export const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
/**
 * Lease-venster waarmee geclaimde due-rijen tijdelijk onzichtbaar worden voor
 * een volgende poll-tick (security-review L2, 2026-08-22). Ruim boven de
 * worst-case batchduur (50 rijen × 10s timeout) zodat een trage tick geen rij
 * dubbel bezorgt; bij een crash mid-delivery keert de rij na dit venster terug.
 */
const CLAIM_LEASE_MS = 15 * 60_000;
const PERMANENT_STATUS_CODES = new Set([400, 401, 403, 404, 410]);

export type DeliveryRow = {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  http_status: number | null;
  error: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  dedup_key: string;
  created_at: Date;
};

export type WebhookJoinRow = {
  id: string;
  team_id: string;
  name: string;
  url: string;
  secret_encrypted: string;
  active: boolean;
  failure_count: number;
};

const PERMANENT_4XX = Array.from(PERMANENT_STATUS_CODES);

/** HMAC-SHA256 over de raw body; header-waarde `sha256=<hex>`. */
export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Timing-safe verificatie van een `x-scanpal-signature`-header. */
export function verifySignature(
  secret: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, body), "utf8");
  const actual = Buffer.from(signature ?? "", "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** entityId (part 2 van de dedup-key) uit een dedup_key halen. */
export function entityIdFromDedupKey(dedupKey: string): string {
  return dedupKey.split(":")[2] ?? "";
}

/**
 * Payload verrijken met site/scan-context (besluit plan 15): alleen
 * ontbrekende velden invullen — site_id/site_url (site- of scan-entity)
 * en scan_id/score (scan-entity).
 */
export async function enrichPayload(
  db: Pool,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!entityId || (payload.site_id && payload.scan_id)) return payload;

  const result = await db.query(
    `select sc.id as scan_id, sc.score, st.id as site_id, st.url as site_url
       from scans sc
       join sites st on st.id = sc.site_id
      where sc.id = $1
     union all
     select null, null, st.id as site_id, st.url as site_url
       from sites st
      where st.id = $1
     limit 1`,
    [entityId],
  );

  if (result.rowCount === 0) return payload;

  const row = result.rows[0] as {
    scan_id: string | null;
    score: number | null;
    site_id: string | null;
    site_url: string | null;
  };

  const enriched: Record<string, unknown> = { ...payload };
  if (row.site_id && enriched.site_id === undefined) enriched.site_id = row.site_id;
  if (row.site_url && enriched.site_url === undefined) enriched.site_url = row.site_url;
  if (row.scan_id && enriched.scan_id === undefined) enriched.scan_id = row.scan_id;
  if (row.score !== null && enriched.score === undefined) enriched.score = row.score;
  return enriched;
}

type EnvelopeInput = {
  deliveryId: string;
  event: string;
  createdAt: Date;
  teamId: string;
  data: Record<string, unknown>;
};

export function buildEnvelope(input: EnvelopeInput) {
  return webhookEnvelopeSchema.parse({
    version: 1,
    id: input.deliveryId,
    event: input.event,
    created_at: input.createdAt.toISOString(),
    team_id: input.teamId,
    data: input.data,
  });
}

export function createWebhookDeliverer(deps: WebhookDelivererDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const fetchFn = deps.fetchFn ?? fetch;
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;

  const SELECT_JOIN = `select d.id, d.webhook_id, d.event, d.payload, d.status,
     d.http_status, d.error, d.attempts, d.next_attempt_at, d.dedup_key,
     d.created_at, w.team_id, w.name, w.url, w.secret_encrypted, w.active,
     w.failure_count
   from webhook_deliveries d
   join webhooks w on w.id = d.webhook_id`;

  function toRow(result: {
    rowCount: number | null;
    rows: unknown[];
  }): DeliveryJoinRow | null {
    return result.rowCount ? (result.rows[0] as DeliveryJoinRow) : null;
  }

  /**
   * Redirect-guarded POST: elke redirect-stap opnieuw door de SSRF-guard
   * (anti-DNS-rebinding-escape). Return: { status } of { rejected: reason }.
   */
  async function postGuarded(
    url: string,
    init: RequestInit,
  ): Promise<{ status?: number } | { rejected: string }> {
    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const allowance = await isUrlAllowed(current);
      if (!allowance.ok) return { rejected: `ssrf:${allowance.reason}` };

      const response = await fetchFn(current, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get("location")
      ) {
        current = new URL(response.headers.get("location")!, current).toString();
        continue;
      }
      return { status: response.status };
    }
    return { rejected: "too-many-redirects" };
  }

  async function disableWebhook(
    row: DeliveryJoinRow,
    attempts: number,
  ): Promise<void> {
    await deps.db.query(
      `update webhooks
         set active = false, failure_count = failure_count + 1, updated_at = now()
       where id = $1`,
      [row.webhook_id],
    );
    await deps.db.query(
      `update webhook_deliveries
         set status = 'disabled', attempts = $2, delivered_at = now()
       where id = $1`,
      [row.id, attempts],
    );
    try {
      await deps.notify?.({
        type: "webhook_disabled",
        teamId: row.team_id,
        entityId: row.webhook_id,
        incidentId: row.webhook_id,
        payload: { webhook_name: row.name },
      });
    } catch (err) {
      log(`deliverer: webhook_disabled-notificatie mislukt: ${String(err)}`);
    }
  }

  async function deliverOne(deliveryId: string): Promise<DeliveryOutcome> {
    const row = toRow(
      await deps.db.query(
        `${SELECT_JOIN} where d.id = $1`,
        [deliveryId],
      ),
    );
    if (!row) return { status: "not-found" };
    if (row.status === "ok" || row.status === "rejected" || row.status === "disabled") {
      return { status: row.status as DeliveryOutcome["status"] };
    }
    if (!row.active) {
      await deps.db.query(
        `update webhook_deliveries set status = 'disabled'
         where id = $1 and status in ('pending', 'failed')`,
        [row.id],
      );
      return { status: "disabled" };
    }

    const attempts = row.attempts + 1;

    const allowance = await isUrlAllowed(row.url);
    if (!allowance.ok) {
      await deps.db.query(
        `update webhook_deliveries
           set status = 'rejected', attempts = $2, error = $3, delivered_at = now()
         where id = $1`,
        [row.id, attempts, `ssrf:${allowance.reason}`],
      );
      log(`deliverer: delivery ${row.id} geweigerd (${allowance.reason})`);
      return { status: "rejected", reason: allowance.reason };
    }

    let secret: string;
    try {
      secret = decryptWebhookSecret(deps.secretKey, row.secret_encrypted);
    } catch (err) {
      return await handleFailure(row, attempts, `decrypt:${String(err)}`);
    }

    const entityId = entityIdFromDedupKey(row.dedup_key);
    const data = await enrichPayload(deps.db, entityId, row.payload ?? {});
    const envelope = buildEnvelope({
      deliveryId: row.id,
      event: row.event,
      createdAt: row.created_at,
      teamId: row.team_id,
      data,
    });
    const body = JSON.stringify(envelope);
    if (Buffer.byteLength(body) > WEBHOOK_MAX_PAYLOAD_BYTES) {
      await deps.db.query(
        `update webhook_deliveries
           set status = 'rejected', attempts = $2, error = $3, delivered_at = now()
         where id = $1`,
        [row.id, attempts, "payload-too-large"],
      );
      return { status: "rejected", reason: "payload-too-large" };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "ScanPal-Webhooks/1.0",
      "x-scanpal-signature": signPayload(secret, body),
      "x-scanpal-timestamp": String(Math.floor(now().getTime() / 1000)),
      "x-scanpal-event": row.event,
      "x-scanpal-delivery": row.id,
    };

    let result: { status?: number } | { rejected: string };
    try {
      result = await postGuarded(row.url, { method: "POST", headers, body });
    } catch (err) {
      return await handleFailure(row, attempts, `http:${String(err)}`);
    }

    if ("rejected" in result) {
      await deps.db.query(
        `update webhook_deliveries
           set status = 'rejected', attempts = $2, error = $3, delivered_at = now()
         where id = $1`,
        [row.id, attempts, result.rejected],
      );
      log(`deliverer: delivery ${row.id} geweigerd (${result.rejected})`);
      return { status: "rejected", reason: result.rejected };
    }

    const status = result.status ?? 0;
    if (status >= 200 && status < 300) {
      await deps.db.query(
        `update webhook_deliveries
           set status = 'ok', http_status = $2, error = null, attempts = $3,
               next_attempt_at = null, delivered_at = now()
         where id = $1`,
        [row.id, status, attempts],
      );
      await deps.db.query(
        `update webhooks
           set last_delivery_at = now(), last_http_status = $2,
               failure_count = 0, updated_at = now()
         where id = $1`,
        [row.webhook_id, status],
      );
      return { status: "ok" };
    }

    if (PERMANENT_4XX.includes(status)) {
      await deps.db.query(
        `update webhook_deliveries
           set status = 'rejected', http_status = $2, attempts = $3,
               delivered_at = now()
         where id = $1`,
        [row.id, status, attempts],
      );
      await deps.db.query(
        `update webhooks
           set last_delivery_at = now(), last_http_status = $2, updated_at = now()
         where id = $1`,
        [row.webhook_id, status],
      );
      log(`deliverer: delivery ${row.id} permanent geweigerd (HTTP ${status})`);
      return { status: "rejected", reason: `http-${status}` };
    }

    return await handleFailure(
      row,
      attempts,
      `http-${status}`,
      status,
    );
  }

  /** Mislukte (retrybare) poging: backoff-schema of disable na max attempts. */
  async function handleFailure(
    row: DeliveryJoinRow,
    attempts: number,
    error: string,
    httpStatus?: number,
  ): Promise<DeliveryOutcome> {
    const isTest = row.event === "test";
    const atMax = attempts >= maxAttempts;

    if (isTest || atMax) {
      if (!isTest) {
        await disableWebhook(row, attempts);
        log(
          `deliverer: delivery ${row.id} na ${attempts} pogingen mislukt ` +
            `(${error}); webhook ${row.webhook_id} uitgeschakeld`,
        );
        return { status: "disabled" };
      }
      await deps.db.query(
        `update webhook_deliveries
           set status = 'failed', http_status = $2, error = $3, attempts = $4,
               delivered_at = now()
         where id = $1`,
        [row.id, httpStatus ?? null, error, attempts],
      );
      return { status: "failed" };
    }

    const backoff = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    const nextAttempt = new Date(now().getTime() + backoff);
    await deps.db.query(
      `update webhook_deliveries
         set status = 'failed', http_status = $2, error = $3, attempts = $4,
             next_attempt_at = $5
       where id = $1`,
      [row.id, httpStatus ?? null, error, attempts, nextAttempt],
    );
    await deps.db.query(
      `update webhooks
         set last_delivery_at = now(), last_http_status = $2,
             failure_count = failure_count + 1, updated_at = now()
       where id = $1`,
      [row.webhook_id, httpStatus ?? null],
    );
    return { status: "failed" };
  }

  /** Eén poll-rondje van de deliverer-loop (scheduler; later BullMQ). */
  async function deliverDue(): Promise<DeliverDueResult> {
    const result: DeliverDueResult = {
      attempted: 0,
      delivered: 0,
      rejected: 0,
      failed: 0,
      disabled: 0,
    };

    // Claim de due-rijen atomair in één transactie: `for update skip locked`
    // houdt de rijlock alleen zolang de transactie loopt, dus zónder omringende
    // BEGIN/COMMIT (zoals voorheen op de Pool) komt de lock direct vrij en pakt
    // een overlappende tick — de scheduler awaakt de vorige `tick()` niet af —
    // dezelfde nog-`pending` rijen opnieuw op → dubbele delivery. We leasen de
    // geclaimde rijen (next_attempt_at vooruit) binnen de lock en verwerken ze
    // daarna BUITEN de lock, zodat deliverOne's eigen updates niet op de lock
    // wachten (security-review L2, 2026-08-22).
    const client = await deps.db.connect();
    let due: DeliveryJoinRow[];
    try {
      await client.query("begin");
      const selected = await client.query(
        `${SELECT_JOIN}
          where d.status in ('pending', 'failed')
            and (d.next_attempt_at is null or d.next_attempt_at <= $1)
          order by d.created_at
          limit 50
          for update skip locked`,
        [now().toISOString()],
      );
      due = selected.rows as DeliveryJoinRow[];
      if (due.length > 0) {
        const leaseUntil = new Date(now().getTime() + CLAIM_LEASE_MS).toISOString();
        await client.query(
          `update webhook_deliveries set next_attempt_at = $2
           where id = any($1::uuid[])`,
          [due.map((row) => row.id), leaseUntil],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    for (const row of due) {
      result.attempted += 1;
      const outcome = await deliverOne(row.id);
      if (outcome.status === "ok") result.delivered += 1;
      if (outcome.status === "rejected") result.rejected += 1;
      if (outcome.status === "failed") result.failed += 1;
      if (outcome.status === "disabled") result.disabled += 1;
    }

    return result;
  }

  return { deliverDue, deliverOne };
}

type DeliveryJoinRow = DeliveryRow & WebhookJoinRow;
