import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Feature 25 — HMAC-request-signing naast bearer-auth (plan 14, uitgesteld).
 * De client tekent een canonieke string (method + path + timestamp + body-hash)
 * met als secret `sha256(apiKey)` (= `key_hash` in de DB, hergebruikt als
 * HMAC-secret zodat geen migratie nodig is). De server leest `key_hash` uit de
 * DB en verifieert de signature timing-safe. De full key wordt nooit over de
 * draad gestuurd — alleen prefix + timestamp + signature.
 *
 * Client-afleiding van het secret:
 *   secret = sha256(fullApiKey)   // hex
 * De server gebruikt dezelfde sha256 (opgeslagen als `key_hash`).
 */

export const HMAC_AUTH_SCHEME = "HMAC";
export const HMAC_SIGNATURE_HEADER = "X-Signature";
export const HMAC_TIMESTAMP_HEADER = "X-Timestamp";
/** Max skew tussen client-klok en server (seconden). */
export const HMAC_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Canonieke request-string die de client tekent en de server herberekent:
 * `METHOD\nPATH\nTIMESTAMP\nBODY_HASH` (alles hex/body-hash lowercase).
 */
export function canonicalRequestString(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
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
