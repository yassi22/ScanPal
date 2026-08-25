import { z } from "zod";
import {
  extractBundleSecrets,
  maskSecret,
  type BundleKeyType,
} from "./bundle-secrets";

/**
 * Browser storage & session-token scanner (plan 70). Puur-gegevens-module: de
 * netwerklaag (`captureStorage` in de Playwright-runner) leest
 * `localStorage`/`sessionStorage` na `goto`; deze module classificeert de entries
 * en maskeert de waarde (nooit de volledige token in evidence/DB/logs).
 *
 * Hergebruikt de secret-classificatie uit `bundle-secrets.ts` (JWT's, Supabase-
 * keys, `sk_live_`, private keys, etc.) plus een kleine JWT-decode voor
 * `alg`/`exp`/claims.
 */

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Minimale base64url-decode (JWT-payload; alleen ASCII-substrings nodig). */
function decodeBase64Url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const table: Record<string, number> = {};
  for (let i = 0; i < BASE64_CHARS.length; i++) table[BASE64_CHARS[i]] = i;
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const ch of b64) {
    if (ch === "=") break;
    const n = table[ch];
    if (n === undefined) continue;
    buffer = (buffer << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return result;
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

/** Geparseerde JWT-meta (alleen wat we veilig kunnen tonen). */
export type JwtMeta = {
  alg: string | null;
  exp_present: boolean;
  /** Dagen tot exp, of `null` als er geen exp is / de datum onleesbaar is. */
  exp_days: number | null;
};

/**
 * Decode een JWT-header/payload en retourneer veilig-toonbare meta. `null` als
 * de input geen geldige JWT-vorm heeft. Claim-waarden worden niet opgeslagen
 * (privacy — plan 70, besluit 4).
 */
export function decodeJwtMeta(raw: string): JwtMeta | null {
  if (!JWT_RE.test(raw)) return null;
  try {
    const parts = raw.split(".");
    const header = JSON.parse(decodeBase64Url(parts[0]));
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    const alg = typeof header.alg === "string" ? header.alg : null;
    const exp = payload.exp;
    let exp_present = false;
    let exp_days: number | null = null;
    if (typeof exp === "number") {
      exp_present = true;
      const ms = exp * 1000;
      if (!Number.isNaN(ms)) {
        exp_days = Math.floor((ms - Date.now()) / 86_400_000);
      }
    }
    return { alg, exp_present, exp_days };
  } catch {
    return null;
  }
}

export const browserStorageKindSchema = z.enum([
  "jwt",
  "secret",
  "session-token",
  "other",
]);
export type BrowserStorageKind = z.infer<typeof browserStorageKindSchema>;

export const browserStorageEntrySchema = z.object({
  store: z.enum(["local", "session"]),
  key: z.string(),
  kind: browserStorageKindSchema,
  /** Gemaskeerde waarde (eerste/laatste tekens); nooit de volledige token. */
  masked: z.string(),
  /** Secret-type uit bundle-secrets-classificatie, alleen als kind === "secret". */
  secret_type: z.string().nullable(),
  jwt: z
    .object({
      alg: z.string().nullable(),
      exp_present: z.boolean(),
      exp_days: z.number().nullable(),
    })
    .nullable(),
});
export type BrowserStorageEntry = z.infer<typeof browserStorageEntrySchema>;

/** Ruwe storage-snapshot zoals de runner teruggeeft (vóór classificatie). */
export type StorageSnapshot = {
  local: Record<string, string>;
  session: Record<string, string>;
};

/** Keys die wijzen op een session-token (heuristisch, plan 70, besluit 3). */
const SESSION_TOKEN_KEY_RE =
  /^(?:session|sess|sid|token|access[_-]?token|auth[_-]?token|jwt|refresh[_-]?token)/i;

/**
 * Classificeer één storage-entry (plan 70, stap 2). Puur — geen netwerk. Volgorde:
 * 1. secret-classificatie via `extractBundleSecrets` (service-role, sk_live_, …).
 * 2. JWT-herkenning (eyJ….) met `decodeJwtMeta` voor alg/exp.
 * 3. session-token-heuristiek op de key-naam.
 * 4. anders `other`.
 *
 * De waarde wordt altijd gemaskeerd via `maskSecret` (plan 70, besluit 4).
 */
export function classifyStorageEntry(
  store: "local" | "session",
  key: string,
  value: string,
): BrowserStorageEntry {
  const masked = maskSecret(value);
  const jwt = decodeJwtMeta(value);

  // 1. Secret-classificatie (hergebruik bundle-secrets-patronen).
  const secrets = extractBundleSecrets(value);
  if (secrets.length > 0) {
    const top = secrets[0]!;
    return {
      store,
      key,
      kind: "secret",
      masked,
      secret_type: top.key_type,
      jwt: jwt,
    };
  }

  // 2. JWT.
  if (jwt !== null) {
    return {
      store,
      key,
      kind: "jwt",
      masked,
      secret_type: null,
      jwt,
    };
  }

  // 3. Session-token-heuristiek op key-naam.
  if (SESSION_TOKEN_KEY_RE.test(key)) {
    return {
      store,
      key,
      kind: "session-token",
      masked,
      secret_type: null,
      jwt: null,
    };
  }

  // 4. Other.
  return {
    store,
    key,
    kind: "other",
    masked,
    secret_type: null,
    jwt: null,
  };
}

/**
 * Classificeer een volledige storage-snapshot → entries-array. Lege storage
 * levert een lege array (de check emit dan een info-finding, plan 70, besluit 3).
 */
export function classifyStorage(
  snapshot: StorageSnapshot,
): BrowserStorageEntry[] {
  const entries: BrowserStorageEntry[] = [];
  for (const [key, value] of Object.entries(snapshot.local)) {
    entries.push(classifyStorageEntry("local", key, value));
  }
  for (const [key, value] of Object.entries(snapshot.session)) {
    entries.push(classifyStorageEntry("session", key, value));
  }
  return entries;
}

/** Severity voor één storage-entry (plan 70, besluit 3). */
export function storageEntrySeverity(
  entry: BrowserStorageEntry,
): "critical" | "high" | "medium" | "low" | "info" {
  if (entry.kind === "secret") {
    // service-role / private key / sk_live_ → critical; rest volgt bundle-secrets.
    const criticalTypes: BundleKeyType[] = [
      "supabase_service_role",
      "private_key",
      "stripe_secret_key",
      "stripe_restricted_key",
      "openai_api_key",
      "github_token",
      "slack_token",
      "sendgrid_api_key",
      "twilio_api_key",
      "npm_token",
    ];
    if (criticalTypes.includes(entry.secret_type as BundleKeyType)) {
      return "critical";
    }
    return "high";
  }
  if (entry.kind === "jwt") {
    // JWT in localStorage: persisteert over tabs/sessies, XSS-exfiltreerbaar.
    // Langlopend/afwezige exp → medium; korte exp → low.
    if (entry.jwt && !entry.jwt.exp_present) return "medium";
    if (entry.jwt && entry.jwt.exp_days !== null && entry.jwt.exp_days > 30) {
      return "medium";
    }
    return "low";
  }
  if (entry.kind === "session-token") {
    // session-token in localStorage i.p.v. HttpOnly-cookie → low (anti-patroon).
    return "low";
  }
  return "info";
}

/** Gestructureerd evidence van de browser-storage-check. */
export const browserStorageEvidenceSchema = z.object({
  kind: z.literal("browser-storage"),
  entries: z.array(browserStorageEntrySchema),
});
export type BrowserStorageEvidence = z.infer<typeof browserStorageEvidenceSchema>;
