import { z } from "zod";
import { findingSeveritySchema, type FindingSeverity } from "./severity";

/**
 * JS-bundel-inspectie (plan 53): sourcemap-aware secrets-extractie uit
 * client-bundles. Deze module is puur functioneel (geen netwerk, geen DB) —
 * de download/resolutie-logica woont in de runner (apps/web).
 */

export const BUNDLE_SCAN_LIMITS = {
  /** Max aantal bundels per scan. */
  maxBundles: 25,
  /** Max grootte per bundel (5 MB). Groter → overgeslagen + info-finding. */
  maxBundleBytes: 5 * 1024 * 1024,
  /** Max aantal matches per scan (afkappen, evidence blijft klein). */
  maxMatches: 50,
  /** Timeout per download (bundel én sourcemap). */
  downloadTimeoutMs: 10000,
  /** Per-host Redis rate-limit (verplicht uit AGENTS.md). */
  downloadsPerHostPerMinute: 60,
} as const;

/** Providers die een eigen regex-set hebben (UI-badges + filtering). */
export const bundleProviderSchema = z.enum([
  "stripe",
  "openai",
  "supabase",
  "google",
  "github",
  "aws",
  "slack",
  "sendgrid",
  "twilio",
  "mapbox",
  "npm",
  "generic",
]);
export type BundleSecretProvider = z.infer<typeof bundleProviderSchema>;

export const bundleProviderLabels: Record<BundleSecretProvider, string> = {
  stripe: "Stripe",
  openai: "OpenAI",
  supabase: "Supabase",
  google: "Google",
  github: "GitHub",
  aws: "AWS",
  slack: "Slack",
  sendgrid: "SendGrid",
  twilio: "Twilio",
  mapbox: "Mapbox",
  npm: "npm",
  generic: "Algemeen",
};

/**
 * Key-type bepaalt de severity (besluit 5): productie-keys (sk_live_, …)
 * scoren hoger dan test/anon-keys (pk_live_, supabase.anon, …).
 */
export const bundleKeyTypeSchema = z.enum([
  "stripe_secret_key",
  "stripe_test_secret_key",
  "stripe_publishable_key",
  "stripe_restricted_key",
  "openai_api_key",
  "supabase_service_role",
  "supabase_anon_key",
  "google_api_key",
  "private_key",
  "github_token",
  "aws_access_key_id",
  "slack_token",
  "sendgrid_api_key",
  "twilio_api_key",
  "mapbox_public_token",
  "npm_token",
  "generic_token",
]);
export type BundleKeyType = z.infer<typeof bundleKeyTypeSchema>;

export const bundleKeyTypeLabels: Record<BundleKeyType, string> = {
  stripe_secret_key: "Stripe secret key",
  stripe_test_secret_key: "Stripe test secret key",
  stripe_publishable_key: "Stripe publishable key",
  stripe_restricted_key: "Stripe restricted key",
  openai_api_key: "OpenAI API key",
  supabase_service_role: "Supabase service-role key",
  supabase_anon_key: "Supabase anon key",
  google_api_key: "Google API key (Firebase)",
  private_key: "Private key (PEM)",
  github_token: "GitHub token",
  aws_access_key_id: "AWS access key ID",
  slack_token: "Slack token",
  sendgrid_api_key: "SendGrid API key",
  twilio_api_key: "Twilio API key",
  mapbox_public_token: "Mapbox public token",
  npm_token: "npm token",
  generic_token: "API key/token (generic)",
};

export function severityForBundleKeyType(keyType: BundleKeyType): FindingSeverity {
  switch (keyType) {
    case "stripe_secret_key":
    case "stripe_restricted_key":
    case "openai_api_key":
    case "supabase_service_role":
    case "private_key":
    case "github_token":
    case "slack_token":
    case "sendgrid_api_key":
    case "twilio_api_key":
    case "npm_token":
      return "critical";
    case "aws_access_key_id":
      return "high";
    case "stripe_test_secret_key":
    case "generic_token":
      return "medium";
    default:
      return "low";
  }
}

/**
 * Masker-helper (besluit 6): nooit de volledige waarde zichtbaar. Lange
 * waarden → max 4+4 tekens; korte waarden (≤8) → alleen het eerste teken als
 * type-hint, zodat PIN's/tokens niet volledig in evidence/logs/UI lekken.
 */
export function maskSecret(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 8) return `${value[0]}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Shannon-entropie per karakter (voor generieke tokens). */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Entropy-drempel voor generieke tokens (calibratie, besluit/open vraag). */
export const ENTROPY_THRESHOLD = 3.5;

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Minimale base64url-decode (JWT-payloads; alleen ASCII-substrings nodig). */
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

/**
 * Supabase-JWT (eyJ…): payload noemt `iss: "supabase"`; `role: "service_role"`
 * → service-role (kritiek), anders anon (laag) — CheckVibe-onderscheid.
 * Geen supabase-marker → null (geen match, voorkomt generieke JWT-false-positives).
 */
export function classifySupabaseJwt(raw: string): BundleKeyType | null {
  try {
    const decoded = decodeBase64Url(raw.split(".")[1] ?? "");
    if (!decoded.includes("supabase")) return null;
    return decoded.includes("service_role")
      ? "supabase_service_role"
      : "supabase_anon_key";
  } catch {
    return null;
  }
}

export type BundleSecretPattern = {
  provider: BundleSecretProvider;
  keyType: BundleKeyType;
  label: string;
  regex: RegExp;
  /** Groep die de geheime waarde bevat (standaard 0 = volledige match). */
  captureGroup?: number;
  /** Vereis hoge entropie op de waarde (generieke tokens). */
  entropy?: boolean;
  /** Optionele herclassificatie per match (bijv. supabase-rol); null = skip. */
  classify?: (raw: string) => BundleKeyType | null;
};

export const bundleSecretPatterns: BundleSecretPattern[] = [
  {
    provider: "stripe",
    keyType: "stripe_secret_key",
    label: "Stripe secret key",
    regex: /sk_live_[0-9a-zA-Z]{16,}/g,
  },
  {
    provider: "stripe",
    keyType: "stripe_test_secret_key",
    label: "Stripe test secret key",
    regex: /sk_test_[0-9a-zA-Z]{16,}/g,
  },
  {
    provider: "stripe",
    keyType: "stripe_publishable_key",
    label: "Stripe publishable key",
    regex: /pk_(?:live|test)_[0-9a-zA-Z]{16,}/g,
  },
  {
    provider: "stripe",
    keyType: "stripe_restricted_key",
    label: "Stripe restricted key",
    regex: /rk_live_[0-9a-zA-Z]{16,}/g,
  },
  {
    provider: "openai",
    keyType: "openai_api_key",
    label: "OpenAI API key",
    regex: /sk-proj-[A-Za-z0-9_-]{20,}/g,
  },
  {
    provider: "openai",
    keyType: "openai_api_key",
    label: "OpenAI API key",
    regex: /sk-[A-Za-z0-9]{20,}/g,
  },
  {
    provider: "supabase",
    keyType: "supabase_anon_key",
    label: "Supabase key (JWT)",
    regex: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}/g,
    classify: classifySupabaseJwt,
  },
  {
    provider: "supabase",
    keyType: "supabase_service_role",
    label: "Supabase service-role key",
    regex: /sb_secret_[A-Za-z0-9_-]{20,}/g,
  },
  {
    provider: "supabase",
    keyType: "supabase_anon_key",
    label: "Supabase publishable key",
    regex: /sb_publishable_[A-Za-z0-9_-]{20,}/g,
  },
  {
    provider: "google",
    keyType: "google_api_key",
    label: "Google API key (Firebase)",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    provider: "generic",
    keyType: "private_key",
    label: "Private key (PEM)",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]{0,500}?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    provider: "github",
    keyType: "github_token",
    label: "GitHub token",
    regex: /gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  {
    provider: "github",
    keyType: "github_token",
    label: "GitHub fine-grained PAT",
    regex: /github_pat_[A-Za-z0-9_]{22,}/g,
  },
  {
    provider: "aws",
    keyType: "aws_access_key_id",
    label: "AWS access key ID",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    provider: "slack",
    keyType: "slack_token",
    label: "Slack token",
    regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
  },
  {
    provider: "sendgrid",
    keyType: "sendgrid_api_key",
    label: "SendGrid API key",
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    provider: "twilio",
    keyType: "twilio_api_key",
    label: "Twilio API key",
    regex: /\bSK[0-9a-fA-F]{32}\b/g,
  },
  {
    provider: "mapbox",
    keyType: "mapbox_public_token",
    label: "Mapbox public token",
    regex: /pk\.eyJ[A-Za-z0-9_-]{20,}/g,
  },
  {
    provider: "npm",
    keyType: "npm_token",
    label: "npm token",
    regex: /\bnpm_[A-Za-z0-9]{36,}\b/g,
  },
  {
    provider: "generic",
    keyType: "generic_token",
    label: "API key/token (generic)",
    regex: /(?:api[_-]?key|apikey|secret|access[_-]?key|client[_-]?secret|auth[_-]?token)\s*[:=]\s*["']([A-Za-z0-9_\-\.]{16,})["']/gi,
    captureGroup: 1,
    entropy: true,
  },
];

export type ExtractedBundleSecret = {
  key_type: BundleKeyType;
  provider: BundleSecretProvider;
  /** Ruwe waarde — alleen in-memory (dedupe); nooit opslaan of loggen. */
  raw: string;
  preview: string;
  severity: FindingSeverity;
};

/**
 * Extraheert geheimen uit JS-bundelcode (en sourcemap `sourcesContent`).
 * `entropyThreshold` geldt voor generieke tokens; alle patronen zijn
 * provider-specifiek met bekende key-prefixen (besluit 5).
 */
export function extractBundleSecrets(
  text: string,
  options: { entropyThreshold?: number } = {},
): ExtractedBundleSecret[] {
  const threshold = options.entropyThreshold ?? ENTROPY_THRESHOLD;
  const results: ExtractedBundleSecret[] = [];
  for (const pattern of bundleSecretPatterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const raw =
        pattern.captureGroup !== undefined
          ? (match[pattern.captureGroup] ?? match[0])
          : match[0];
      if (pattern.entropy && shannonEntropy(raw) < threshold) {
        if (regex.lastIndex === match.index) regex.lastIndex++;
        continue;
      }
      const keyType = pattern.classify ? pattern.classify(raw) : pattern.keyType;
      if (keyType === null) {
        if (regex.lastIndex === match.index) regex.lastIndex++;
        continue;
      }
      results.push({
        key_type: keyType,
        provider: pattern.provider,
        raw,
        preview: maskSecret(raw),
        severity: severityForBundleKeyType(keyType),
      });
      if (regex.lastIndex === match.index) regex.lastIndex++;
    }
  }
  return results;
}

/** Bevat de URL van een sourcemap, of een inline (base64) map. */
const SOURCE_MAPPING_COMMENT_RE = /[#@]\s*sourceMappingURL=(\S+)/;

export type SourceMappingRef =
  | { kind: "url"; url: string }
  | { kind: "inline"; payload: string; base64: boolean };

/** Statische parse van het sourceMappingURL-comment (besluit 4). */
export function parseSourceMappingComment(code: string): SourceMappingRef | null {
  const match = SOURCE_MAPPING_COMMENT_RE.exec(code);
  if (!match) return null;
  const raw = match[1];
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    if (comma === -1) return null;
    const meta = raw.slice(0, comma);
    const payload = raw.slice(comma + 1);
    return { kind: "inline", payload, base64: meta.includes(";base64") };
  }
  return { kind: "url", url: raw };
}

/**
 * Haalt `script src`-URL's uit HTML (mini-crawler-uitvoer komt er in de
 * runner nog bij). Resolve tegen `baseUrl` waar mogelijk.
 */
export function extractScriptSrc(html: string, baseUrl?: string): string[] {
  const urls: string[] = [];
  const re = /<script[^>]*\bsrc=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      urls.push(baseUrl ? new URL(raw, baseUrl).toString() : raw);
    } catch {
      // ongeldige URL overslaan
    }
  }
  return urls;
}

/** Finding-detail per match (plan 53 contract). */
export const bundleSecretMatchSchema = z.object({
  key_type: bundleKeyTypeSchema,
  provider: bundleProviderSchema,
  /** Bundel-URL waarin de key gevonden is. */
  file: z.string().url(),
  /** Match gevonden via een sourcemap (sourcesContent). */
  sourcemap: z.boolean(),
  /** Gemaskeerd (eerste 4 + laatste 4 tekens). */
  match_preview: z.string(),
  severity: findingSeveritySchema,
});
export type BundleSecretMatch = z.infer<typeof bundleSecretMatchSchema>;

/** Gestructureerd evidence van de secrets-in-bundles-check. */
export const bundleSecretEvidenceSchema = z.object({
  kind: z.literal("bundle-secrets"),
  matches: z.array(bundleSecretMatchSchema),
  /** Info-notities: overgeslagen bundels, sourcemap-404, … */
  notes: z.array(z.string()).default([]),
});
export type BundleSecretEvidence = z.infer<typeof bundleSecretEvidenceSchema>;