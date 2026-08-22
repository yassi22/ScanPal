import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Feature 25 — HMAC-request-signing naast bearer-auth (plan 14, uitgesteld).
 * De client tekent een canonieke string (method + path + gesorteerde query +
 * timestamp + body-hash) met een *afgeleid* secret:
 *
 *   key_hash   = sha256(fullApiKey)                // opgeslagen in de DB
 *   signing_secret = sha256(DERIVATION_PREFIX + ":" + key_hash)
 *
 * De DB slaat alleen `key_hash` op; het HMAC-secret wordt er domein-
 * gescheiden uit afgeleid met een server-side constante (`API_HMAC_SIGNING_
 * SECRET`, env). Wie alleen de DB/backup leest kan daardoor géén geldige
 * signatures forgen (pass-the-hash fix): hij mist de derivatie-secret.
 * Clients die de full key bezitten kunnen het secret wél afleiden.
 */

export const HMAC_AUTH_SCHEME = "HMAC";
export const HMAC_SIGNATURE_HEADER = "X-Signature";
export const HMAC_TIMESTAMP_HEADER = "X-Timestamp";
/** Max skew tussen client-klok en server (seconden). */
export const HMAC_TIMESTAMP_TOLERANCE_SECONDS = 300;
/** Server-side derivatie-constante; anders dan de key-hash in de DB. */
export const HMAC_SIGNING_SECRET_ENV = "API_HMAC_SIGNING_SECRET";

/**
 * Afgeleid HMAC-secret uit `key_hash` (sha256 van de full key). De client
 * berekent: sha256(API_HMAC_SIGNING_SECRET + ":" + sha256(fullApiKey)).
 * Een DB-leak alleen is onvoldoende om requests te forgen.
 */
export function deriveHmacSigningSecret(keyHash: string): string {
  const domain = process.env[HMAC_SIGNING_SECRET_ENV];
  if (!domain) {
    throw new Error(
      `Missing ${HMAC_SIGNING_SECRET_ENV}: HMAC request signing is disabled until the env var is set. Refusing to derive a signing secret from a hardcoded fallback (DB-leak would allow signature forgery).`,
    );
  }
  return sha256Hex(`${domain}:${keyHash}`);
}

/**
 * Canonieke query-string: `?a=1&b=2` → `a=1&b=2` met gesorteerde paren.
 * Géén parameter mag het verschil maken tussen twee requests met dezelfde
 * signature (anders blijft een geldige GET-signature ook voor
 * `?site_id=…`-varianten geldig binnen het replay-venster).
 */
export function canonicalQueryString(search: string): string {
  const raw = search.replace(/^\?/, "");
  if (!raw) return "";
  return raw.split("&").sort().join("&");
}

/**
 * Canonieke request-string die de client tekent en de server herberekent:
 * `METHOD\nPATH\nQUERY\nTIMESTAMP\nBODY_HASH` (alles hex/body-hash lowercase).
 */
export function canonicalRequestString(
  method: string,
  path: string,
  query: string,
  timestamp: string,
  bodyHash: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${query}\n${timestamp}\n${bodyHash}`;
}

/** sha256 van een string, hex-output. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** HMAC-SHA256 signature (hex) van de canonieke string met het secret. */
export function signHmacRequest(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

/**
 * Timing-safe signature-verificatie. Aanvallers leren niets uit
 * responstijd-verschil. Lengte-verschil → false (geen crash).
 */
export function verifyHmacSignature(
  secret: string,
  canonical: string,
  signature: string,
): boolean {
  const expected = signHmacRequest(secret, canonical);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse `Authorization: HMAC <prefix>` → `{ keyPrefix }` of `null`.
 * `<prefix>` is de publieke 15-char key-prefix (`sp_live_…`) uit de DB.
 */
export function parseHmacAuth(header: string | null): {
  keyPrefix: string;
} | null {
  if (!header) return null;
  const match = header.match(/^HMAC\s+(sp_live_[A-Za-z0-9_-]+)$/i);
  if (!match) return null;
  return { keyPrefix: match[1] };
}

/**
 * Controleer of de timestamp binnen de tolerantie van `now` valt
 * (replay-bescherming).
 */
export function isTimestampValid(
  timestamp: string,
  now: Date = new Date(),
  toleranceSeconds: number = HMAC_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !/^[0-9]+$/.test(timestamp.trim())) return false;
  const diff = Math.abs(now.getTime() / 1000 - ts);
  return diff <= toleranceSeconds;
}

/**
 * Leest de request-body via een clone (originel stream blijft beschikbaar voor
 * de route-handler) en retourneert de sha256-hex. GET/no-body → sha256("").
 */
export async function requestBodyHash(request: Request): Promise<string> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    return sha256Hex("");
  }
  try {
    const clone = request.clone();
    const text = await clone.text();
    return sha256Hex(text);
  } catch {
    // body niet leesbaar (al geconsumeerd / stream-lock) → lege-hash fallback
    return sha256Hex("");
  }
}
