import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  webhookDeliveryViewSchema,
  webhookViewSchema,
  type WebhookDeliveryView,
  type WebhookView,
} from "@scanpal/shared";
import type { WebhookRow, WebhookDeliveryRow } from "@scanpal/db";
import {
  createWebhookDeliverer,
  encryptWebhookSecret,
  generateWebhookSecret,
  isUrlAllowed,
} from "@scanpal/notify";

/**
 * Webhook-CRUD (plan 15, feature 15 + 23). Secrets worden AES-GCM-versleuteld
 * opgeslagen (`WEBHOOK_SECRET_KEY`) en zijn alleen bij create/rotate 1×
 * zichtbaar. SSRF-guard bij create én bij delivery (packages/notify).
 */

export class WebhookNotConfiguredError extends Error {
  constructor() {
    super("Webhooks zijn niet geconfigureerd (WEBHOOK_SECRET_KEY ontbreekt)");
    this.name = "WebhookNotConfiguredError";
  }
}

export class WebhookLimitError extends Error {
  constructor(public limit: number) {
    super(`Webhook-limiet bereikt (maximaal ${limit} per team)`);
    this.name = "WebhookLimitError";
  }
}

export class WebhookUrlError extends Error {
  constructor(reason: string) {
    super(`URL is niet toegestaan (${reason})`);
    this.name = "WebhookUrlError";
  }
}

function toWebhookView(row: WebhookRow): WebhookView {
  return webhookViewSchema.parse({
    id: row.id,
    team_id: row.team_id,
    name: row.name,
    url: row.url,
    events: row.events,
    active: row.active,
    failure_count: row.failure_count,
    last_delivery_at: row.last_delivery_at ? row.last_delivery_at.toISOString() : null,
    last_http_status: row.last_http_status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

const WEBHOOK_COLUMNS =
  "id, team_id, created_by, name, url, secret_encrypted, events, active, failure_count, last_delivery_at, last_http_status, created_at, updated_at";

export async function listWebhooks(
  db: Pool,
  teamId: string,
): Promise<WebhookView[]> {
  const result = await db.query(
    `select ${WEBHOOK_COLUMNS} from webhooks
     where team_id = $1
     order by created_at desc`,
    [teamId],
  );
  return (result.rows as WebhookRow[]).map(toWebhookView);
}

export async function getWebhook(
  db: Pool,
  input: { teamId: string; webhookId: string },
): Promise<WebhookRow | null> {
  const result = await db.query(
    `select ${WEBHOOK_COLUMNS} from webhooks
     where id = $1 and team_id = $2`,
    [input.webhookId, input.teamId],
  );
  return result.rowCount ? (result.rows[0] as WebhookRow) : null;
}

export type CreateWebhookResult = {
  view: WebhookView;
  secret: string;
};

export async function createWebhook(
  db: Pool,
  input: {
    teamId: string;
    createdBy: string;
    name: string;
    url: string;
    events: string[];
    secretKey: string;
    maxWebhooks: number;
  },
): Promise<CreateWebhookResult> {
  if (!input.secretKey) throw new WebhookNotConfiguredError();

  const allowance = await isUrlAllowed(input.url);
  if (!allowance.ok) throw new WebhookUrlError(allowance.reason);

  const count = await db.query(
    "select count(*)::int as n from webhooks where team_id = $1",
    [input.teamId],
  );
  if ((count.rows[0].n as number) >= input.maxWebhooks) {
    throw new WebhookLimitError(input.maxWebhooks);
  }

  const secret = generateWebhookSecret();
  const secretEncrypted = encryptWebhookSecret(input.secretKey, secret);

  const result = await db.query(
    `insert into webhooks (team_id, created_by, name, url, secret_encrypted, events)
     values ($1, $2, $3, $4, $5, $6)
     returning ${WEBHOOK_COLUMNS}`,
    [input.teamId, input.createdBy, input.name, input.url, secretEncrypted, input.events],
  );

  return { view: toWebhookView(result.rows[0] as WebhookRow), secret };
}

export async function updateWebhook(
  db: Pool,
  input: {
    teamId: string;
    webhookId: string;
    patch: { name?: string; url?: string; events?: string[]; active?: boolean };
    secretKey: string;
  },
): Promise<WebhookView | null> {
  if (input.patch.url) {
    const allowance = await isUrlAllowed(input.patch.url);
    if (!allowance.ok) throw new WebhookUrlError(allowance.reason);
  }

  const sets: string[] = [];
  const params: unknown[] = [input.webhookId, input.teamId];
  const assignments: Record<string, unknown> = {
    name: input.patch.name,
    url: input.patch.url,
    events: input.patch.events,
    active: input.patch.active,
  };
  for (const [col, value] of Object.entries(assignments)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  sets.push("updated_at = now()");

  const result = await db.query(
    `update webhooks set ${sets.join(", ")}
     where id = $1 and team_id = $2
     returning ${WEBHOOK_COLUMNS}`,
    params,
  );
  return result.rowCount ? toWebhookView(result.rows[0] as WebhookRow) : null;
}

export async function deleteWebhook(
  db: Pool,
  input: { teamId: string; webhookId: string },
): Promise<boolean> {
  const result = await db.query(
    "delete from webhooks where id = $1 and team_id = $2",
    [input.webhookId, input.teamId],
  );
  return (result.rowCount ?? 0) > 0;
}

export type RotateSecretResult = {
  view: WebhookView;
  secret: string;
};

export async function rotateWebhookSecret(
  db: Pool,
  input: { teamId: string; webhookId: string; secretKey: string },
): Promise<RotateSecretResult | null> {
  if (!input.secretKey) throw new WebhookNotConfiguredError();

  const secret = generateWebhookSecret();
  const result = await db.query(
    `update webhooks
       set secret_encrypted = $3, updated_at = now()
     where id = $1 and team_id = $2
     returning ${WEBHOOK_COLUMNS}`,
    [input.webhookId, input.teamId, encryptWebhookSecret(input.secretKey, secret)],
  );
  if (!result.rowCount) return null;
  return { view: toWebhookView(result.rows[0] as WebhookRow), secret };
}

function toDeliveryView(row: WebhookDeliveryRow): WebhookDeliveryView {
  return webhookDeliveryViewSchema.parse({
    id: row.id,
    webhook_id: row.webhook_id,
    event: row.event,
    status: row.status,
    http_status: row.http_status,
    error: row.error,
    attempts: row.attempts,
    next_attempt_at: row.next_attempt_at ? row.next_attempt_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    delivered_at: row.delivered_at ? row.delivered_at.toISOString() : null,
  });
}

export async function listWebhookDeliveries(
  db: Pool,
  input: { teamId: string; webhookId: string; limit: number; offset: number },
): Promise<{ deliveries: WebhookDeliveryView[]; total: number }> {
  const [list, count] = await Promise.all([
    db.query(
      `select d.id, d.webhook_id, d.event, d.payload, d.status, d.http_status,
         d.error, d.attempts, d.next_attempt_at, d.dedup_key, d.created_at,
         d.delivered_at
       from webhook_deliveries d
       join webhooks w on w.id = d.webhook_id
       where w.team_id = $1 and d.webhook_id = $2
       order by d.created_at desc
       limit $3 offset $4`,
      [input.teamId, input.webhookId, input.limit, input.offset],
    ),
    db.query(
      `select count(*)::int as n
       from webhook_deliveries d
       join webhooks w on w.id = d.webhook_id
       where w.team_id = $1 and d.webhook_id = $2`,
      [input.teamId, input.webhookId],
    ),
  ]);

  return {
    deliveries: (list.rows as WebhookDeliveryRow[]).map(toDeliveryView),
    total: count.rows[0].n as number,
  };
}

/**
 * Test-delivery: een `test`-rij aanmaken (unieke dedup_key per klik) en
 * direct door de deliverer sturen — de webapp voert hier bewust dezelfde
 * delivery-code uit als de scheduler-loop.
 */
export async function sendTestWebhook(
  db: Pool,
  input: { teamId: string; webhookId: string; secretKey: string },
): Promise<{ delivery: WebhookDeliveryView } | null> {
  if (!input.secretKey) throw new WebhookNotConfiguredError();

  const webhook = await getWebhook(db, input);
  if (!webhook) return null;

  const dedupKey = `test:${input.webhookId}:${randomUUID()}:`;
  const inserted = await db.query(
    `insert into webhook_deliveries (webhook_id, event, payload, dedup_key)
     values ($1, 'test', '{}'::jsonb, $2)
     returning id, webhook_id, event, payload, status, http_status, error,
       attempts, next_attempt_at, dedup_key, created_at, delivered_at`,
    [input.webhookId, dedupKey],
  );
  const deliveryId = inserted.rows[0].id as string;

  const deliverer = createWebhookDeliverer({
    db,
    secretKey: input.secretKey,
    log: console.log,
  });
  await deliverer.deliverOne(deliveryId);

  const updated = await db.query(
    `select id, webhook_id, event, payload, status, http_status, error,
       attempts, next_attempt_at, dedup_key, created_at, delivered_at
     from webhook_deliveries where id = $1`,
    [deliveryId],
  );
  return { delivery: toDeliveryView(updated.rows[0] as WebhookDeliveryRow) };
}
