import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  apiKeyViewSchema,
  type ApiKeyView,
} from "@scanpal/shared";
import type { ApiKeyRow } from "@scanpal/db";

export const API_KEY_PREFIX = "sp_live_";

/** Full key: `sp_live_` + 32 random bytes (base64url). Alleen bij creatie terug. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** DB slaat alleen de sha256-hex van de key op. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function toApiKeyView(row: ApiKeyRow): ApiKeyView {
  const view = apiKeyViewSchema.parse({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
    revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  });
  return view;
}

export type CreateApiKeyResult = {
  view: ApiKeyView;
  fullKey: string;
};

export async function createApiKey(
  db: Pool,
  input: { teamId: string; createdBy: string; name: string },
): Promise<CreateApiKeyResult> {
  const fullKey = generateApiKey();
  const hash = hashApiKey(fullKey);
  const prefix = fullKey.slice(0, 15);

  const result = await db.query(
    `insert into api_keys (team_id, created_by, name, prefix, key_hash)
     values ($1, $2, $3, $4, $5)
     returning id, team_id, created_by, name, prefix, key_hash,
       last_used_at, revoked_at, expires_at, created_at`,
    [input.teamId, input.createdBy, input.name, prefix, hash],
  );

  return { view: toApiKeyView(result.rows[0] as ApiKeyRow), fullKey };
}

export async function listApiKeys(
  db: Pool,
  teamId: string,
): Promise<ApiKeyView[]> {
  const result = await db.query(
    `select id, team_id, created_by, name, prefix, key_hash,
       last_used_at, revoked_at, expires_at, created_at
     from api_keys
     where team_id = $1
     order by created_at desc`,
    [teamId],
  );
  return (result.rows as ApiKeyRow[]).map(toApiKeyView);
}

/** Soft-revoke (revoked_at). Retourneert false als de key niet van dit team is. */
export async function revokeApiKey(
  db: Pool,
  input: { teamId: string; keyId: string },
): Promise<boolean> {
  const result = await db.query(
    `update api_keys set revoked_at = now()
     where id = $1 and team_id = $2 and revoked_at is null`,
    [input.keyId, input.teamId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findApiKey(
  db: Pool,
  keyHash: string,
): Promise<ApiKeyRow | null> {
  const result = await db.query(
    `select id, team_id, created_by, name, prefix, key_hash,
       last_used_at, revoked_at, expires_at, created_at
     from api_keys where key_hash = $1`,
    [keyHash],
  );
  return result.rowCount ? (result.rows[0] as ApiKeyRow) : null;
}

/**
 * Feature 25 — lookup op prefix voor HMAC-auth (de client stuurt alleen de
 * prefix, niet de full key). Prefix is uniek per key (32 random bytes).
 */
export async function findApiKeyByPrefix(
  db: Pool,
  prefix: string,
): Promise<ApiKeyRow | null> {
  const result = await db.query(
    `select id, team_id, created_by, name, prefix, key_hash,
       last_used_at, revoked_at, expires_at, created_at
     from api_keys where prefix = $1`,
    [prefix],
  );
  return result.rowCount ? (result.rows[0] as ApiKeyRow) : null;
}

/**
 * Fire-and-forget per verzoek: last_used_at + dag-teller (api_key_usage).
 * Failures worden gelogd, nooit de request laten falen.
 */
export async function recordApiKeyUsage(
  db: Pool,
  keyId: string,
): Promise<void> {
  await db.query("update api_keys set last_used_at = now() where id = $1", [
    keyId,
  ]);
  await db.query(
    `insert into api_key_usage (key_id, day, request_count)
     values ($1, current_date, 1)
     on conflict (key_id, day)
     do update set request_count = api_key_usage.request_count + 1`,
    [keyId],
  );
}
