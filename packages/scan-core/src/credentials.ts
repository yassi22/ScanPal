import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthCredentials } from "@scanpal/shared";

/**
 * Plan 77 — encrypted opslag van het wegwerp-testaccount per site. AES-256-GCM
 * met een 32-byte base64-key uit de omgeving (`AUTH_CREDENTIAL_KEY`), zelfde
 * opslagformaat als webhook-secrets (`v1.<iv>.<tag>.<ciphertext>`, base64url).
 * Tenant-isolated: elke query scopt op team_id (+ optioneel workspace_id).
 * De plaintext-password is alleen bij load 1× zichtbaar (in de worker, in
 * memory) en wordt nooit gelogd.
 */

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const IV_LENGTH = 12;

export class CredentialsNotConfiguredError extends Error {
  constructor() {
    super("Auth-credentials zijn niet geconfigureerd (AUTH_CREDENTIAL_KEY ontbreekt)");
    this.name = "CredentialsNotConfiguredError";
  }
}

function keyBytes(key: string): Buffer {
  return Buffer.from(key, "base64");
}

export function encryptCredential(key: string, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCredential(key: string, stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("onbekend credential-formaat");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

function requireKey(key: string | undefined): string {
  if (!key) throw new CredentialsNotConfiguredError();
  return key;
}

type SaveInput = {
  siteId: string;
  teamId: string;
  workspaceId?: string | null;
  loginUrl: string | null;
  username: string;
  password: string;
  key: string;
};

/** Upsert (één rij per site, unique site_id). Encrypt het password at rest. */
export async function saveAuthCredentials(db: Queryable, input: SaveInput): Promise<void> {
  const key = requireKey(input.key);
  const passwordEncrypted = encryptCredential(key, input.password);
  const params = [input.siteId, input.teamId, input.workspaceId ?? null, input.loginUrl, input.username, passwordEncrypted];
  await db.query(
    `insert into site_auth_credentials (site_id, team_id, workspace_id, login_url, username, password_encrypted)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (site_id) do update
       set login_url = excluded.login_url,
           username = excluded.username,
           password_encrypted = excluded.password_encrypted,
           updated_at = now()
     where site_auth_credentials.team_id = $2`,
    params,
  );
}

type LoadInput = {
  siteId: string;
  teamId?: string;
  workspaceId?: string | null;
  key: string;
};

/** Laadt + decrypt het wegwerp-testaccount. `null` als er geen rij is. */
export async function loadAuthCredentials(db: Queryable, input: LoadInput): Promise<AuthCredentials | null> {
  const key = requireKey(input.key);
  const params: unknown[] = [input.siteId];
  let scope = "";
  if (input.teamId !== undefined) {
    params.push(input.teamId);
    scope += ` and team_id = $${params.length}`;
    if (input.workspaceId !== undefined) {
      params.push(input.workspaceId);
      scope += ` and workspace_id = $${params.length}`;
    }
  }
  const result = await db.query<{ login_url: string | null; username: string; password_encrypted: string }>(
    `select login_url, username, password_encrypted from site_auth_credentials
     where site_id = $1${scope}`,
    params,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    login_url: row.login_url,
    username: row.username,
    password: decryptCredential(key, row.password_encrypted),
  };
}

/** Metadata voor de UI (zonder password): of er een account is + username/loginUrl. */
export async function getAuthCredentialsMeta(
  db: Queryable,
  input: { siteId: string; teamId: string; workspaceId?: string | null },
): Promise<{ has_credentials: boolean; username: string | null; login_url: string | null }> {
  const params: unknown[] = [input.siteId, input.teamId];
  let scope = "";
  if (input.workspaceId !== undefined) {
    params.push(input.workspaceId);
    scope = ` and workspace_id = $${params.length}`;
  }
  const result = await db.query<{ login_url: string | null; username: string }>(
    `select login_url, username from site_auth_credentials
     where site_id = $1 and team_id = $2${scope}`,
    params,
  );
  const row = result.rows[0];
  if (!row) return { has_credentials: false, username: null, login_url: null };
  return { has_credentials: true, username: row.username, login_url: row.login_url };
}

export async function deleteAuthCredentials(
  db: Queryable,
  input: { siteId: string; teamId: string; workspaceId?: string | null },
): Promise<void> {
  const params: unknown[] = [input.siteId, input.teamId];
  let scope = "";
  if (input.workspaceId !== undefined) {
    params.push(input.workspaceId);
    scope = ` and workspace_id = $${params.length}`;
  }
  await db.query(`delete from site_auth_credentials where site_id = $1 and team_id = $2${scope}`, params);
}
