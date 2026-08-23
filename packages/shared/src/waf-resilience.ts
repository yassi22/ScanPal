import { z } from "zod";
import type { HeaderSource } from "./stack-detection";

/**
 * Plan 73 — WAF/CDN-weerbaarheid & API-rate-limit-inspectie (G7). Pure logica
 * (geen fetch): de worker levert de al-gefetchte response-headers; deze module
 * fingerprint het WAF/CDN-platform en inspecteert rate-limit-headers. Beoordeelt
 * bewust andere signalen dan plan 69 (hosting-fingerprint): WAF-aanwezigheid
 * en rate-limit, niet cache-hygiëne/origin-lek/preview-URL — geen dubbele findings.
 */

export type WafCdnFingerprint = {
  /** WAF-productnaam indien herkend (Cloudflare, AWS WAF, …), anders null. */
  waf: string | null;
  /** CDN/platformnaam indien herkend, anders null. */
  cdn: string | null;
  /** Header-namen die tot de detectie leidden (lowercase, uniek). */
  signals: string[];
};

export type RateLimitHeaders = {
  /** Rate-limit-header-namen die aanwezig zijn (lowercase). */
  headers_found: string[];
  /** Waarde van `retry-after` indien aanwezig, anders null. */
  retry_after: string | null;
};

export const wafCdnFingerprintSchema = z.object({
  waf: z.string().nullable(),
  cdn: z.string().nullable(),
  signals: z.array(z.string()),
});
export type WafCdnFingerprintZod = z.infer<typeof wafCdnFingerprintSchema>;

export const rateLimitHeadersSchema = z.object({
  headers_found: z.array(z.string()),
  retry_after: z.string().nullable(),
});
export type RateLimitHeadersZod = z.infer<typeof rateLimitHeadersSchema>;

export const wafResilienceEvidenceSchema = z.object({
  kind: z.literal("waf-resilience"),
  waf: z.string().nullable(),
  cdn: z.string().nullable(),
  signals: z.array(z.string()),
  rate_limit_headers: z.array(z.string()),
  retry_after: z.string().nullable(),
  status_429: z.boolean(),
});
export type WafResilienceEvidence = z.infer<typeof wafResilienceEvidenceSchema>;

function hget(headers: HeaderSource, name: string): string {
  return (headers.get(name) ?? "").toLowerCase();
}

/**
 * Header→WAF/CDN-detectie-regels. Elke regel: een header-naam + een optionele
 * substring-waarde; bij match wordt het platform gelabeld. Volgorde = prioriteit
 * (eerste match wint per categorie). Bewust een superset van plan 69's platform-
 * signalen: G7 rapporteert WAF-aanwezigheid als weerbaarheidssignaal, plan 69
 * rapporteert platform-misconfiguraties — verschillende beoordeling, geen
 * dubbele findings.
 */
type DetectRule = {
  header: string;
  /** Substring in de header-waarde (lowercase); leeg = aanwezigheid volstaat. */
  contains?: string;
  label: string;
  kind: "waf" | "cdn";
};

const DETECT_RULES: DetectRule[] = [
  // Cloudflare (WAF + CDN)
  { header: "cf-ray", label: "Cloudflare", kind: "cdn" },
  { header: "server", contains: "cloudflare", label: "Cloudflare", kind: "cdn" },
  // AWS WAF / CloudFront
  { header: "x-aws-waf-token", label: "AWS WAF", kind: "waf" },
  { header: "x-amzn-trace-id", label: "AWS", kind: "cdn" },
  { header: "x-amz-cf-id", label: "AWS CloudFront", kind: "cdn" },
  // Akamai
  { header: "x-akamai-transformed", label: "Akamai", kind: "cdn" },
  { header: "akamai-grn", label: "Akamai", kind: "cdn" },
  // Sucuri
  { header: "x-sucuri-id", label: "Sucuri", kind: "waf" },
  { header: "server", contains: "sucuri", label: "Sucuri", kind: "waf" },
  // Imperva / Incapsula
  { header: "x-incap-ses", label: "Imperva", kind: "waf" },
  { header: "server", contains: "imperva", label: "Imperva", kind: "waf" },
  // Fastly
  { header: "x-served-by", contains: "cache", label: "Fastly", kind: "cdn" },
  { header: "x-timer", label: "Fastly", kind: "cdn" },
  // Vercel / Netlify (overgenomen signalen)
  { header: "x-vercel-id", label: "Vercel", kind: "cdn" },
  { header: "x-nf-request-id", label: "Netlify", kind: "cdn" },
  // Generieke WAF/CDN-signalen
  { header: "x-cdn", label: "CDN", kind: "cdn" },
  { header: "x-firewall", label: "WAF", kind: "waf" },
  { header: "x-cache", label: "CDN", kind: "cdn" },
];

/**
 * Fingerprint WAF/CDN uit response-headers. Puur; herkent maximaal één WAF en
 * één CDN (eerste match per soort). `signals` bevat de header-namen die tot de
 * detectie leidden (voor evidence).
 */
export function detectWafCdn(headers: HeaderSource): WafCdnFingerprint {
  let waf: string | null = null;
  let cdn: string | null = null;
  const signals: string[] = [];
  for (const rule of DETECT_RULES) {
    const value = hget(headers, rule.header);
    if (!value) continue;
    if (rule.contains && !value.includes(rule.contains)) continue;
    if (rule.kind === "waf" && waf === null) waf = rule.label;
    else if (rule.kind === "cdn" && cdn === null) cdn = rule.label;
    if (!signals.includes(rule.header)) signals.push(rule.header);
  }
  return { waf, cdn, signals };
}

/** Rate-limit-header-namen die geïnspecteerd worden (lowercase). */
const RATE_LIMIT_HEADER_NAMES = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "x-ratelimit-policy",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
];

/**
 * Inspecteert rate-limit-headers. Puur; verzamelt aanwezige header-namen en de
 * `retry-after`-waarde (indien gezet). Aanwezigheid is een positief signaal —
 * de site communiceert rate-limiting expliciet.
 */
export function inspectRateLimitHeaders(headers: HeaderSource): RateLimitHeaders {
  const headers_found: string[] = [];
  for (const name of RATE_LIMIT_HEADER_NAMES) {
    if (headers.get(name)) headers_found.push(name);
  }
  const retry_after = headers.get("retry-after");
  return { headers_found, retry_after };
}

/**
 * Beoordeelt de passieve WAF/rate-limit-meting → één InlineCheckLike-waarde.
 * Puur. Regels (plan 73, besluiten 3/4/7):
 * - `info` — WAF/CDN gedetecteerd (weerbaarheidssignaal aanwezig).
 * - `info` — rate-limit-headers aanwezig (expliciete rate-limiting).
 * - `info` — 429 op de bestaande fetch (rate-limiting al actief).
 * - `low` — géén WAF/CDN én géén rate-limit-headers (mogelijk ontbrekende
 *   rate-limiting; geen stellige uitspraak over bescherming).
 */
export function evaluateWafResilience(
  fp: WafCdnFingerprint,
  rl: RateLimitHeaders,
  status429: boolean,
): { status: "pass" | "warn" | "info"; detail: string; severity?: "low" | "info" } {
  const parts: string[] = [];
  if (fp.waf) parts.push(`WAF: ${fp.waf}`);
  if (fp.cdn) parts.push(`CDN: ${fp.cdn}`);
  const hasProtection = fp.waf !== null || fp.cdn !== null;
  const hasRateLimitHeaders = rl.headers_found.length > 0;

  if (status429) {
    return {
      status: "info",
      detail:
        `Rate-limiting actief (429 op een enkele request). ${parts.join(", ")}`.trim(),
    };
  }

  if (hasProtection && hasRateLimitHeaders) {
    return {
      status: "info",
      detail: `${parts.join(", ")}; rate-limit-headers aanwezig (${rl.headers_found.join(", ")}).`,
    };
  }
  if (hasProtection) {
    return {
      status: "info",
      detail: `${parts.join(", ")} aanwezig; geen expliciete rate-limit-headers (mogelijk op edge afgehandeld).`,
    };
  }
  if (hasRateLimitHeaders) {
    return {
      status: "info",
      detail: `Rate-limit-headers aanwezig (${rl.headers_found.join(", ")}); geen WAF/CDN gedetecteerd.`,
    };
  }
  return {
    status: "warn",
    severity: "low",
    detail:
      "Geen WAF/CDN of rate-limit-headers gedetecteerd — API-endpoints kunnen rate-limiting missen (WAF kan op netwerklaag zitten zonder headers te lekken).",
  };
}

/** Evidence-object voor de finding (geserialiseerd als JSON in de worker). */
export function wafResilienceEvidence(
  fp: WafCdnFingerprint,
  rl: RateLimitHeaders,
  status429: boolean,
): WafResilienceEvidence {
  return {
    kind: "waf-resilience",
    waf: fp.waf,
    cdn: fp.cdn,
    signals: fp.signals,
    rate_limit_headers: rl.headers_found,
    retry_after: rl.retry_after,
    status_429: status429,
  };
}
