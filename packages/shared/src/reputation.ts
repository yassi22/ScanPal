import { z } from "zod";

export const reputationSourceNameSchema = z.enum([
  "spamhaus",
  "urlhaus",
  "safe-browsing",
  "virustotal",
  "abuseipdb",
]);
export type ReputationSourceName = z.infer<typeof reputationSourceNameSchema>;

export const reputationSeveritySchema = z.enum(["high", "medium", "low", "info"]);
export type ReputationSeverity = z.infer<typeof reputationSeveritySchema>;

export const reputationSourceSchema = z.object({
  source: reputationSourceNameSchema,
  queried: z.boolean(),
  listed: z.boolean(),
  categories: z.array(z.string()).optional(),
  detail: z.string().optional(),
  /** Werkelijk querytijdstip; blijft behouden wanneer dit bronresultaat uit cache komt. */
  measured_at: z.string().datetime().optional(),
});
export type ReputationSource = z.infer<typeof reputationSourceSchema>;

export const reputationSchema = z.object({
  host: z.string().min(1),
  ips: z.array(z.string()),
  edge_detected: z.boolean(),
  sources: z.array(reputationSourceSchema),
  worst_severity: reputationSeveritySchema,
  measured_at: z.string().datetime(),
});
export type Reputation = z.infer<typeof reputationSchema>;

export const reputationEvidenceSchema = reputationSchema.extend({
  kind: z.literal("threat-intel"),
});
export type ReputationEvidence = z.infer<typeof reputationEvidenceSchema>;

/** AbuseIPDB confidence waarboven een IP-listing als medium telt (single source). */
export const ABUSEIPDB_HIGH_CONFIDENCE = 75;

function categoryNumber(categories: string[] | undefined, prefix: string): number {
  const raw = categories?.find((category) => category.startsWith(`${prefix}:`));
  if (!raw) return 0;
  const value = Number(raw.slice(prefix.length + 1));
  return Number.isFinite(value) ? value : 0;
}

/**
 * IP-gebaseerde listing: het oordeel slaat op een IP-adres, niet op het domein.
 * Achter een CDN/edge is dat IP vaak het gedeelde edge-adres (geen origin-
 * oordeel), dus zulke listings worden gedempt wanneer `edge_detected`. AbuseIPDB
 * is altijd IP-gebaseerd; Spamhaus alleen wanneer het uitsluitend ZEN-codes
 * (IP-zones) betreft — een DBL-code is een domein-listing en blijft een
 * origin-oordeel.
 */
function isIpBasedListing(source: ReputationSource): boolean {
  if (source.source === "abuseipdb") return true;
  if (source.source === "spamhaus") {
    const categories = source.categories ?? [];
    return categories.length > 0 && categories.every((c) => c.startsWith("ZEN:"));
  }
  return false;
}

/**
 * Pure severity-classificatie voor de gebundelde reputatiebronnen (plan 75).
 * `edgeDetected` dempt IP-gebaseerde listings (zie {@link isIpBasedListing}):
 * achter een CDN/edge kan een IP-listing het gedeelde edge-adres betreffen i.p.v.
 * de origin, dus die signalen tellen dan niet mee voor corroboratie/`high` en
 * worden hoogstens als `low` gerapporteerd (nog steeds zichtbaar, geen fail).
 */
export function classifyReputation(
  sources: ReputationSource[],
  edgeDetected = false,
): ReputationSeverity {
  const listed = sources.filter((source) => source.queried && source.listed);
  if (listed.length === 0) return "info";

  // Origin-oordelen (domein/URL) blijven altijd meetellen; IP-listings worden
  // achter een edge/CDN buiten de corroboratie gehouden.
  const originListed = edgeDetected
    ? listed.filter((source) => !isIpBasedListing(source))
    : listed;

  // Bleef er na demping geen origin-signaal over, dan is de listing edge-only:
  // surface als low (zichtbaar, maar geen origin-fail/score-straf).
  if (originListed.length === 0) return "low";

  if (originListed.length > 1) return "high";

  const source = originListed[0];
  const categories = source.categories ?? [];
  if (
    source.source === "urlhaus" ||
    (source.source === "spamhaus" && categories.some((category) => category.startsWith("DBL:"))) ||
    (source.source === "safe-browsing" &&
      categories.some((category) =>
        [
          "MALWARE",
          "SOCIAL_ENGINEERING",
          "UNWANTED_SOFTWARE",
          "POTENTIALLY_HARMFUL_APPLICATION",
        ].includes(category),
      )) ||
    (source.source === "virustotal" && categoryNumber(categories, "malicious") >= 2)
  ) {
    return "high";
  }

  if (
    (source.source === "spamhaus" && categories.some((category) => category.startsWith("ZEN:"))) ||
    (source.source === "virustotal" &&
      (categoryNumber(categories, "malicious") >= 1 ||
        categoryNumber(categories, "suspicious") >= 2)) ||
    (source.source === "abuseipdb" &&
      categoryNumber(categories, "confidence") >= ABUSEIPDB_HIGH_CONFIDENCE)
  ) {
    return "medium";
  }

  return "low";
}
