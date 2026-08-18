import "server-only";

import { getSessionUser } from "./supabase/server";
import { ensureUserTeam } from "./team";
import { pool } from "./db";
import {
  findApiKey,
  findApiKeyByPrefix,
  hashApiKey,
  recordApiKeyUsage,
} from "./api-keys-core";
import { checkRateLimit } from "./rate-limit";
import { getPlanForTeam } from "./credits";
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  canonicalQueryString,
  canonicalRequestString,
  deriveHmacSigningSecret,
  isTimestampValid,
  parseHmacAuth,
  requestBodyHash,
  verifyHmacSignature,
} from "./api-hmac";

/**
 * Sessie-of-key auth voor alle API-routes (feature 14/25, plan 14).
 * - `Authorization: HMAC <prefix>` + `X-Signature` + `X-Timestamp` →
 *   prefix-lookup, timing-safe signature-verificatie, replay-bescherming.
 * - `Authorization: Bearer sp_...` → sha256-lookup, revoked/expired-check,
 *   rate limiting (per key én per team), fire-and-forget usage-tracking.
 * - Anders: Supabase-sessie → ensureUserTeam.
 * De auth-mode is hier swappable (bearer + HMAC nu). Team-scoping doen de
 * routes zelf via `ctx.teamId` (non-member → 404).
 */

export type TeamContext = {
  teamId: string;
  auth:
    | { type: "session"; userId: string }
    | { type: "key"; keyId: string };
};

export type RequireTeamResult =
  | { ok: true; ctx: TeamContext }
  | { ok: false; status: 401 | 429; retryAfter?: number };

export async function requireTeam(
  request: Request,
): Promise<RequireTeamResult> {
  const authHeader = request.headers.get("authorization");

  // Feature 25 — HMAC-request-signing (voor de bearer-check).
  const hmac = parseHmacAuth(authHeader);
  if (hmac) {
    return requireHmacApiKey(request, hmac.keyPrefix);
  }

  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return requireApiKey(bearerMatch[1].trim());
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };

  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  return {
    ok: true,
    ctx: { teamId: result.team.id, auth: { type: "session", userId: user.id } },
  };
}

/**
 * Feature 25 — HMAC-verificatie. De client stuurt prefix + timestamp +
 * signature; de server herberekent de canonieke string met `key_hash` als
 * secret en vergelijkt timing-safe. Replay-bescherming via timestamp-skew.
 */
async function requireHmacApiKey(
  request: Request,
  keyPrefix: string,
): Promise<RequireTeamResult> {
  const row = await findApiKeyByPrefix(pool, keyPrefix);
  if (!row) return { ok: false, status: 401 };
  if (row.revoked_at) return { ok: false, status: 401 };
  if (row.expires_at && row.expires_at < new Date()) {
    return { ok: false, status: 401 };
  }

  const signature = request.headers.get(HMAC_SIGNATURE_HEADER);
  const timestamp = request.headers.get(HMAC_TIMESTAMP_HEADER);
  if (!signature || !timestamp) return { ok: false, status: 401 };
  if (!isTimestampValid(timestamp)) return { ok: false, status: 401 };

  const bodyHash = await requestBodyHash(request);
  const url = new URL(request.url);
  const path = url.pathname;
  const query = canonicalQueryString(url.search);
  const canonical = canonicalRequestString(
    request.method,
    path,
    query,
    timestamp,
    bodyHash,
  );
  // Signing-secret wordt domein-gescheiden afgeleid uit key_hash (pass-the-hash
  // fix): key_hash zelf is nooit voldoende om een signature te forgen.
  const secret = deriveHmacSigningSecret(row.key_hash);
  if (!verifyHmacSignature(secret, canonical, signature)) {
    return { ok: false, status: 401 };
  }

  const limit = (await getPlanForTeam(pool, row.team_id)).apiRatePerMinute;
  const [perKey, perTeam] = await Promise.all([
    checkRateLimit(`key:${row.id}`, limit),
    checkRateLimit(`team:${row.team_id}`, limit),
  ]);
  if (!perKey.ok) {
    return { ok: false, status: 429, retryAfter: perKey.retryAfterSeconds };
  }
  if (!perTeam.ok) {
    return { ok: false, status: 429, retryAfter: perTeam.retryAfterSeconds };
  }

  recordApiKeyUsage(pool, row.id).catch((err) => {
    console.error("api-key usage bijwerken mislukt:", err);
  });

  return { ok: true, ctx: { teamId: row.team_id, auth: { type: "key", keyId: row.id } } };
}

async function requireApiKey(key: string): Promise<RequireTeamResult> {
  const row = await findApiKey(pool, hashApiKey(key));
  if (!row) return { ok: false, status: 401 };
  if (row.revoked_at) return { ok: false, status: 401 };
  if (row.expires_at && row.expires_at < new Date()) {
    return { ok: false, status: 401 };
  }

  const limit = (await getPlanForTeam(pool, row.team_id)).apiRatePerMinute;

  const [perKey, perTeam] = await Promise.all([
    checkRateLimit(`key:${row.id}`, limit),
    checkRateLimit(`team:${row.team_id}`, limit),
  ]);
  if (!perKey.ok) {
    return { ok: false, status: 429, retryAfter: perKey.retryAfterSeconds };
  }
  if (!perTeam.ok) {
    return { ok: false, status: 429, retryAfter: perTeam.retryAfterSeconds };
  }

  recordApiKeyUsage(pool, row.id).catch((err) => {
    console.error("api-key usage bijwerken mislukt:", err);
  });

  return { ok: true, ctx: { teamId: row.team_id, auth: { type: "key", keyId: row.id } } };
}

export type SessionTeamResult =
  | { ok: true; ctx: { teamId: string; userId: string } }
  | { ok: false; status: 401 };

/**
 * Sessie-only team-auth (géén bearer keys) — voor routes die volgens het
 * contract uitgesloten zijn van key-auth (`webhooks/*`, plan 14). Retourneert
 * teamId + userId van de ingelogde gebruiker.
 */
export async function requireSessionTeam(): Promise<SessionTeamResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };

  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  return { ok: true, ctx: { teamId: result.team.id, userId: user.id } };
}

export type SessionOwnerResult =
  | { ok: true; ctx: { teamId: string; userId: string } }
  | { ok: false; status: 401 | 403 };

/**
 * Sessie-only + owner-gate (voor /api/api-keys*): alleen de team-owner mag
 * keys aanmaken/revoken (plan 14). Members → 403.
 */
export async function requireSessionOwner(): Promise<SessionOwnerResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };

  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  if (result.membership.role !== "owner") {
    return { ok: false, status: 403 };
  }

  return { ok: true, ctx: { teamId: result.team.id, userId: user.id } };
}
