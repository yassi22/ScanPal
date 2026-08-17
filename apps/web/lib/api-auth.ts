import "server-only";

import { getSessionUser } from "./supabase/server";
import { ensureUserTeam } from "./team";
import { pool } from "./db";
import {
  findApiKey,
  hashApiKey,
  recordApiKeyUsage,
} from "./api-keys-core";
import { checkRateLimit } from "./rate-limit";
import { getPlanForTeam } from "./credits";

/**
 * Sessie-of-key auth voor alle API-routes (feature 14/25, plan 14).
 * - `Authorization: Bearer sp_...` → sha256-lookup, revoked/expired-check,
 *   rate limiting (per key én per team), fire-and-forget usage-tracking.
 * - Anders: Supabase-sessie → ensureUserTeam.
 * De auth-mode is hier swappable (bearer nu; HMAC kan later zonder de
 * routes te raken). Team-scoping doen de routes zelf via `ctx.teamId`
 * (non-member → 404).
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
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i);

  if (match) {
    return requireApiKey(match[1].trim());
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
