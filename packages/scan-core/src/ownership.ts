import dns from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import type { Pool, PoolClient } from "pg";
import {
  matchesOwnershipTxt,
  OWNERSHIP_METHOD,
  ownershipRecordValue,
  registrableDomain,
  type Ownership,
  type OwnershipCheckReason,
} from "@scanpal/shared";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type OwnershipRow = {
  id: string;
  url: string;
  ownership_token: string;
  ownership_verified_at: Date | null;
  ownership_method: string | null;
};

export type OwnershipDeps = {
  db: Queryable;
  dnsResolver?: typeof dns;
  /**
   * Optionele tenant-scope. Meegeven scopet de site-lookup expliciet op
   * team (en workspace) i.p.v. te leunen op de aanroepende gate — zo is de
   * tenant-grens consistent met `ensureOwnershipToken`/`recordOwnershipCheck`
   * (defense-in-depth).
   */
  teamId?: string;
  workspaceId?: string | null;
};

export type OwnershipCheckResult =
  | { verified: true; token: string }
  | { verified: false; reason: OwnershipCheckReason; token?: string };

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function generateOwnershipToken(): string {
  return encodeBase32(randomBytes(32));
}

export function ownershipRecordNameForSiteUrl(siteUrl: string): string | null {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`,
    );
    const apex = registrableDomain(parsed.hostname);
    if (!apex) return null;
    return domainToASCII(apex) || null;
  } catch {
    return null;
  }
}

function toOwnership(row: OwnershipRow): Ownership | null {
  const recordName = ownershipRecordNameForSiteUrl(row.url);
  if (!recordName) return null;
  return {
    token: row.ownership_token,
    record_name: recordName,
    record_value: ownershipRecordValue(row.ownership_token),
    verified_at: row.ownership_verified_at?.toISOString() ?? null,
  };
}

export async function ensureOwnershipToken(
  db: Queryable,
  input: { siteId: string; teamId: string; workspaceId?: string | null },
  tokenFactory: () => string = generateOwnershipToken,
): Promise<Ownership | null> {
  const workspaceScope =
    input.workspaceId === undefined ? "" : " and workspace_id = $4";
  const result = await db.query<OwnershipRow>(
    `update sites
     set ownership_token = coalesce(ownership_token, $3)
     where id = $1 and team_id = $2${workspaceScope}
     returning id, url, ownership_token, ownership_verified_at, ownership_method`,
    input.workspaceId === undefined
      ? [input.siteId, input.teamId, tokenFactory()]
      : [input.siteId, input.teamId, tokenFactory(), input.workspaceId],
  );
  const row = result.rows[0];
  return row ? toOwnership(row) : null;
}

export async function rotateOwnershipToken(
  db: Queryable,
  input: { siteId: string; teamId: string; workspaceId?: string | null },
  tokenFactory: () => string = generateOwnershipToken,
): Promise<Ownership | null> {
  const workspaceScope =
    input.workspaceId === undefined ? "" : " and workspace_id = $4";
  const result = await db.query<OwnershipRow>(
    `update sites
     set ownership_token = $3,
         ownership_verified_at = null,
         ownership_method = null
     where id = $1 and team_id = $2${workspaceScope}
     returning id, url, ownership_token, ownership_verified_at, ownership_method`,
    input.workspaceId === undefined
      ? [input.siteId, input.teamId, tokenFactory()]
      : [input.siteId, input.teamId, tokenFactory(), input.workspaceId],
  );
  const row = result.rows[0];
  return row ? toOwnership(row) : null;
}

export async function checkOwnershipLive(
  siteId: string,
  deps: OwnershipDeps,
): Promise<OwnershipCheckResult> {
  const params: unknown[] = [siteId];
  let scope = "";
  if (deps.teamId !== undefined) {
    params.push(deps.teamId);
    scope += ` and team_id = $${params.length}`;
    if (deps.workspaceId !== undefined) {
      params.push(deps.workspaceId);
      scope += ` and workspace_id = $${params.length}`;
    }
  }
  const result = await deps.db.query<
    Pick<OwnershipRow, "url" | "ownership_token">
  >(
    `select url, ownership_token from sites where id = $1${scope}`,
    params,
  );
  const site = result.rows[0];
  if (!site) return { verified: false, reason: "site-not-found" };
  if (!site.ownership_token) {
    return { verified: false, reason: "token-missing" };
  }

  const recordName = ownershipRecordNameForSiteUrl(site.url);
  if (!recordName) {
    return {
      verified: false,
      reason: "invalid-site-url",
      token: site.ownership_token,
    };
  }

  try {
    const records = await (deps.dnsResolver ?? dns).resolveTxt(recordName);
    return matchesOwnershipTxt(records, site.ownership_token)
      ? { verified: true, token: site.ownership_token }
      : {
          verified: false,
          reason: "record-not-found",
          token: site.ownership_token,
        };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const reason =
      code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN"
        ? "record-not-found"
        : "dns-lookup-failed";
    return { verified: false, reason, token: site.ownership_token };
  }
}

export async function verifyOwnershipLive(
  siteId: string,
  deps: OwnershipDeps,
): Promise<boolean> {
  return (await checkOwnershipLive(siteId, deps)).verified;
}

export async function recordOwnershipCheck(
  db: Queryable,
  input: {
    siteId: string;
    teamId: string;
    token: string;
    verified: boolean;
    workspaceId?: string | null;
  },
): Promise<Date | null | undefined> {
  const workspaceScope =
    input.workspaceId === undefined ? "" : " and workspace_id = $6";
  const result = await db.query<{ ownership_verified_at: Date | null }>(
    `update sites
     set ownership_verified_at = case when $4 then now() else null end,
         ownership_method = case when $4 then $5 else null end
     where id = $1 and team_id = $2 and ownership_token = $3${workspaceScope}
     returning ownership_verified_at`,
    input.workspaceId === undefined
      ? [input.siteId, input.teamId, input.token, input.verified, OWNERSHIP_METHOD]
      : [
          input.siteId,
          input.teamId,
          input.token,
          input.verified,
          OWNERSHIP_METHOD,
          input.workspaceId,
        ],
  );
  return result.rows[0]?.ownership_verified_at;
}
