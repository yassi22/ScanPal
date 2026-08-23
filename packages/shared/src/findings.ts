import { z } from "zod";
import { scanCategorySchema, severityCountsSchema } from "./scan-progress";
import type { ScanCategory, SeverityCounts } from "./scan-progress";
import { checkById } from "./check-catalog";
import { evidenceSchema, type FindingEvidence } from "./active-tests";
import { bundleSecretEvidenceSchema, type BundleSecretEvidence } from "./bundle-secrets";
import {
  engineMatrixEvidenceSchema,
  type EngineMatrixEvidence,
  aiEngineLabels,
} from "./aeo-engine-matrix";
import { complianceEvidenceSchema, type ComplianceEvidence } from "./compliance";
import { metaTagsEvidenceSchema, type MetaTagsEvidence } from "./meta-tags";
import {
  stackDetectionEvidenceSchema,
  type StackDetectionEvidence,
} from "./stack-detection";
import {
  hostingFingerprintEvidenceSchema,
  type HostingFingerprintEvidence,
} from "./hosting-fingerprint";
import {
  redirectsMixedEvidenceSchema,
  type RedirectsMixedEvidence,
} from "./redirects-mixed";
import {
  subresourcesEvidenceSchema,
  type SubresourcesEvidence,
} from "./subresources";
import {
  structuredDataEvidenceSchema,
  type StructuredDataEvidence,
} from "./structured-data";
import {
  securityTxtEvidenceSchema,
  type SecurityTxtEvidence,
} from "./security-txt";
import {
  robotsSitemapEvidenceSchema,
  type RobotsSitemapEvidence,
} from "./robots-sitemap";
import {
  secretsInHtmlEvidenceSchema,
  type SecretsInHtmlEvidence,
} from "./secrets-in-html";
import {
  miniCrawlEvidenceSchema,
  type MiniCrawlEvidence,
} from "./mini-crawl";
import {
  repoHealthEvidenceSchema,
  type RepoHealthEvidence,
} from "./repo-health";
import {
  semgrepEvidenceSchema,
  gitleaksEvidenceSchema,
  osvEvidenceSchema,
  type SemgrepEvidence,
  type GitleaksEvidence,
  type OsvEvidence,
} from "./sast-findings";
import {
  cwvEvidenceSchema,
  type CwvEvidence,
} from "./browser-vitals";
import {
  cruxEvidenceSchema,
  cruxDivergenceEvidenceSchema,
  CRUX_VITAL_LABELS,
  type CruxEvidence,
  type CruxDivergenceEvidence,
} from "./crux";
import {
  axeEvidenceSchema,
  type AxeEvidence,
} from "./accessibility";
import {
  consoleEvidenceSchema,
  responsiveEvidenceSchema,
  type ConsoleEvidence,
  type ResponsiveEvidence,
} from "./browser-runtime";
import {
  renderCompareEvidenceSchema,
  type RenderCompareEvidence,
} from "./aeo-render";
import {
  browserStorageEvidenceSchema,
  type BrowserStorageEvidence,
} from "./browser-storage";
import {
  findingSeveritySchema,
  severityOrder,
  severityRank,
  type FindingSeverity,
} from "./severity";
export {
  findingSeveritySchema,
  severityOrder,
  severityRank,
};
export type { FindingSeverity } from "./severity";

export const findingStatusSchema = z.enum(["open", "fixed", "ignored"]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

/**
 * Snooze (plan 59 besluit 5): ISO-datetime (7/30 dagen) óf `"next-scan"`.
 * Gesnoozde findings tellen niet mee in diff-alerts maar blijven in de view.
 */
export const snoozeSchema = z
  .union([z.string().datetime(), z.literal("next-scan")])
  .nullable();
export type Snooze = z.infer<typeof snoozeSchema>;

export const findingSchema = z.object({
  id: z.string(),
  check_id: z.string(),
  category: scanCategorySchema,
  severity: findingSeveritySchema,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  /** String (passieve checks) óf structured `{ request, response }` (actieve tests, plan 52) óf bundel-secret-evidence (plan 53) óf AEO-engine-matrix (plan 55) óf compliance-signalen (plan 61) óf meta-tags-evidence (plan 35). */
  evidence: z
    .union([
      z.string(),
      evidenceSchema,
      bundleSecretEvidenceSchema,
      engineMatrixEvidenceSchema,
      complianceEvidenceSchema,
      metaTagsEvidenceSchema,
      stackDetectionEvidenceSchema,
      hostingFingerprintEvidenceSchema,
      redirectsMixedEvidenceSchema,
      subresourcesEvidenceSchema,
      structuredDataEvidenceSchema,
      securityTxtEvidenceSchema,
      robotsSitemapEvidenceSchema,
      secretsInHtmlEvidenceSchema,
      miniCrawlEvidenceSchema,
      repoHealthEvidenceSchema,
      semgrepEvidenceSchema,
      gitleaksEvidenceSchema,
      osvEvidenceSchema,
      cwvEvidenceSchema,
      cruxEvidenceSchema,
      cruxDivergenceEvidenceSchema,
      axeEvidenceSchema,
      consoleEvidenceSchema,
      responsiveEvidenceSchema,
      renderCompareEvidenceSchema,
      browserStorageEvidenceSchema,
    ])
    .nullable(),
  /** Actieve-test-finding (plan 52): telt niet mee in de overall-score. */
  active: z.boolean().default(false),
  status: findingStatusSchema.default("open"),
  note: z.string().nullable(),
  /** Plan 54: route waarop de check de finding vond (null = site-level, bijv. github). */
  route_url: z.string().url().nullable().default(null),
  /** Plan 59: dismissed-then-returned — was ooit fixed/ignored en komt terug. */
  regressed: z.boolean().default(false),
  /** Plan 59: tijdelijk dempen van diff-alerts (7/30 dagen of tot volgende scan). */
  snooze_until: snoozeSchema.default(null),
  created_at: z.string().datetime(),
});
export type Finding = z.infer<typeof findingSchema>;

export const findingsPayloadSchema = z.object({
  v: z.literal(1),
  items: z.array(findingSchema),
});
export type FindingsPayload = z.infer<typeof findingsPayloadSchema>;

/**
 * PATCH-body (plan 09, uitgebreid in plan 59): `status` én `snooze_until` zijn
 * allebei optioneel — een snooze-actie verandert de status niet en omgekeerd.
 */
export const findingStatusUpdateSchema = z
  .object({
    status: findingStatusSchema.optional(),
    note: z.string().trim().max(500).optional(),
    snooze_until: snoozeSchema.optional(),
  })
  .refine((value) => value.status !== undefined || value.snooze_until !== undefined, {
    message: "Geef status of snooze_until op",
  });
export type FindingStatusUpdate = z.infer<typeof findingStatusUpdateSchema>;

export const findingsQuerySchema = z.object({
  severity: findingSeveritySchema.optional(),
  category: scanCategorySchema.optional(),
  status: findingStatusSchema.optional(),
  /** Plan 52: filter op actieve-test-findings (`active: true`). */
  active: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean().optional()),
  q: z.string().trim().max(200).optional(),
  /** Plan 53: filter op bundel-secret key_type (secrets-in-bundles). */
  key_type: z.string().optional(),
  /** Plan 54: filter op de route waarop de finding is gevonden. */
  route_url: z.string().optional(),
  sort: z.enum(["severity", "created_at", "title"]).optional().default("severity"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FindingsQuery = z.infer<typeof findingsQuerySchema>;

export const findingsResponseSchema = z.object({
  findings: z.array(findingSchema),
  total: z.number().int().min(0),
  counts: severityCountsSchema,
  categories: z.array(scanCategorySchema),
  /** Plan 53: beschikbare bundel-secret key_types (voor de filter-dropdown). */
  key_types: z.array(z.string()).default([]),
  /** Plan 54: beschikbare routes (voor de route-filter-dropdown). */
  routes: z.array(z.string()).default([]),
});
export type FindingsResponse = z.infer<typeof findingsResponseSchema>;

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function countSeverities(
  items: Pick<Finding, "severity">[],
): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

/**
 * Stabiele finding-id binnen een scan: `${check_id}:${title-slug}`. Determin
 * en onafhankelijk van het tijdstip, zodat carry-over van status over scans
 * (plan 09, besluit 2) en PATCH-routes op dezelfde id kunnen rekenen.
 */
export function findingId(checkId: string, title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${checkId}:${slug}`;
}

/**
 * Kopieert status + note + snooze van de vorige scan naar de nieuwe op basis
 * van de stabiele finding-id: `fixed`/`ignored` (incl. note) blijven staan,
 * `open` wordt overschreven door de nieuwe scan (plan 09, besluit 8). De
 * snooze (plan 59) wordt altijd overgenomen zodat een 7/30-dagen-demping
 * meerdere scans overleeft; `regressed` wordt per scan opnieuw berekend.
 */
export function applyFindingStatusCarryOver(
  current: FindingsPayload,
  previous: FindingsPayload | null,
): FindingsPayload {
  if (!previous || previous.items.length === 0) return current;
  const previousById = new Map(previous.items.map((finding) => [finding.id, finding]));
  return {
    ...current,
    items: current.items.map((item) => {
      const previousItem = previousById.get(item.id);
      if (!previousItem) return item;
      return {
        ...item,
        snooze_until: previousItem.snooze_until,
        ...(previousItem.status !== "open"
          ? { status: previousItem.status, note: previousItem.note }
          : {}),
      };
    }),
  };
}

export type InlineCheckLike = {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn" | "info";
  detail: string;
  /** Plan 52: actieve-test-check — telt niet mee in de overall-score. */
  active?: boolean;
  /** Plan 53: severity-override (bijv. kritieke bundel-secrets). */
  severity?: FindingSeverity;
  evidence?:
    | FindingEvidence
    | BundleSecretEvidence
    | EngineMatrixEvidence
    | ComplianceEvidence
    | MetaTagsEvidence
    | StackDetectionEvidence
    | HostingFingerprintEvidence
    | RedirectsMixedEvidence
    | SubresourcesEvidence
    | StructuredDataEvidence
    | SecurityTxtEvidence
    | RobotsSitemapEvidence
    | SecretsInHtmlEvidence
    | MiniCrawlEvidence
    | RepoHealthEvidence
    | SemgrepEvidence
    | GitleaksEvidence
    | OsvEvidence
    | CwvEvidence
    | CruxEvidence
    | CruxDivergenceEvidence
    | AxeEvidence
    | ConsoleEvidence
    | ResponsiveEvidence
    | RenderCompareEvidence
    | BrowserStorageEvidence
    | string
    | null;
};

/** Helper om evidence (string óf structured) als zoekbare tekst te gebruiken. */
export function evidenceText(
  evidence:
    | string
    | FindingEvidence
    | BundleSecretEvidence
    | EngineMatrixEvidence
    | ComplianceEvidence
    | MetaTagsEvidence
    | StackDetectionEvidence
    | HostingFingerprintEvidence
    | RedirectsMixedEvidence
    | SubresourcesEvidence
    | StructuredDataEvidence
    | SecurityTxtEvidence
    | RobotsSitemapEvidence
    | SecretsInHtmlEvidence
    | MiniCrawlEvidence
    | RepoHealthEvidence
    | SemgrepEvidence
    | GitleaksEvidence
    | OsvEvidence
    | CwvEvidence
    | CruxEvidence
    | CruxDivergenceEvidence
    | AxeEvidence
    | ConsoleEvidence
    | ResponsiveEvidence
    | RenderCompareEvidence
    | BrowserStorageEvidence
    | null,
): string {
  if (!evidence) return "";
  if (typeof evidence === "string") return evidence;
  if ("kind" in evidence) {
    if (evidence.kind === "crux-field-data") {
      const m = evidence.data.metrics;
      return `lcp p75=${m.lcp.p75} (good ${m.lcp.good}, ni ${m.lcp.needs_improvement}, poor ${m.lcp.poor}) | inp p75=${m.inp.p75} (good ${m.inp.good}, ni ${m.inp.needs_improvement}, poor ${m.inp.poor}) | cls p75=${m.cls.p75} (good ${m.cls.good}, ni ${m.cls.needs_improvement}, poor ${m.cls.poor})`;
    }
    if (evidence.kind === "crux-divergence") {
      return evidence.divergences
        .map(
          (d) =>
            `${CRUX_VITAL_LABELS[d.vital]} lab=${d.lab_value} field=${d.field_value} (delta ${d.delta}, drempel ${d.threshold})`,
        )
        .join(" | ");
    }
    if (evidence.kind === "bundle-secrets") {
      return evidence.matches
        .map(
          (match) =>
            `${match.key_type} ${match.provider} ${match.file} ${match.match_preview}`,
        )
        .join(" ");
    }
    if (evidence.kind === "aeo-engine-matrix") {
      const engines = evidence.engine_matrix
        .map(
          (row) =>
            `${aiEngineLabels[row.engine]} ${row.reachable ? "bereikbaar" : "geblokkeerd"} ${row.parseable ? "parseerbaar" : "niet-parseerbaar"} ${row.reason}`,
        )
        .join(" ");
      const llms = evidence.llms_txt.present
        ? `llms.txt aanwezig parseerbaar=${evidence.llms_txt.parseable}`
        : "llms.txt afwezig";
      return `${engines} ${llms}`;
    }
    if (evidence.kind === "compliance") {
      return evidence.signals
        .map((signal) => `${signal.signal}: ${signal.detail}`)
        .join("\n");
    }
    if (evidence.kind === "meta-tags") {
      return `present: ${evidence.present.join(", ")}; missing: ${evidence.missing.join(", ")}`;
    }
    if (evidence.kind === "stack-detection") {
      return evidence.detected
        .map((s) => `${s.name} (${s.category}) ${s.signals.join("; ")}`)
        .join(" | ");
    }
    if (evidence.kind === "hosting-fingerprint") {
      const signals = evidence.signals
        .map((s) => `${s.signal}:${s.severity} ${s.detail}`)
        .join(" | ");
      return `platform=${evidence.platform}${signals ? ` | ${signals}` : ""}`;
    }
    if (evidence.kind === "redirects-mixed") {
      return `redirected=${evidence.redirected} https_upgraded=${evidence.https_upgraded} final=${evidence.final_url} mixed=${evidence.mixed_content.length}`;
    }
    if (evidence.kind === "subresources") {
      return `total=${evidence.total} with_integrity=${evidence.with_integrity} missing=${evidence.missing_integrity.length}`;
    }
    if (evidence.kind === "structured-data") {
      return `total=${evidence.total} valid=${evidence.valid} invalid=${evidence.invalid} types=${evidence.types.join(",")}`;
    }
    if (evidence.kind === "security-txt") {
      return `security_txt=${evidence.security_txt.present} favicon=${evidence.favicon.present} 404=${evidence.not_found_page.is_404}`;
    }
    if (evidence.kind === "robots-sitemap") {
      const robots = evidence.robots_txt;
      const sitemap = evidence.sitemap;
      return `robots=${robots.present ? "aanwezig" : "afwezig"} user_agents=${robots.user_agents.join(",")} sitemap=${sitemap.present ? `aanwezig (${sitemap.url_count} locs)` : "afwezig"} error=${sitemap.error ?? "geen"}`;
    }
    if (evidence.kind === "secrets-in-html") {
      return evidence.matches
        .map((match) => `${match.key_type} ${match.provider} ${match.location} ${match.match_preview}`)
        .join(" ");
    }
    if (evidence.kind === "mini-crawl") {
      return `images_total=${evidence.image_audit.total} images_missing_alt=${evidence.image_audit.missing} orphans=${evidence.orphan_pages.orphan_count}/${evidence.orphan_pages.sitemap_count}`;
    }
    if (evidence.kind === "repo-health") {
      return evidence.signals
        .map((s) => `${s.signal}:${s.status} ${s.detail}`)
        .join(" | ");
    }
    if (evidence.kind === "semgrep") {
      return `total=${evidence.total} high=${evidence.by_severity.high} medium=${evidence.by_severity.medium} low=${evidence.by_severity.low}`;
    }
    if (evidence.kind === "gitleaks") {
      return evidence.samples
        .map((s) => `${s.rule_id} ${s.file}:${s.start_line} ${s.match_preview}`)
        .join(" ");
    }
    if (evidence.kind === "osv-scanner") {
      return `total=${evidence.total} critical=${evidence.by_severity.critical} high=${evidence.by_severity.high} medium=${evidence.by_severity.medium} low=${evidence.by_severity.low}`;
    }
    if (evidence.kind === "core-web-vitals") {
      return `lcp=${evidence.lcp_ms}(${evidence.ratings.lcp}) cls=${evidence.cls}(${evidence.ratings.cls}) inp=${evidence.inp_ms}(${evidence.ratings.inp})`;
    }
    if (evidence.kind === "accessibility") {
      return evidence.samples
        .map((s) => `${s.impact}:${s.id} (${s.node_count} node(s)) ${s.help}`)
        .join(" | ");
    }
    if (evidence.kind === "console-errors") {
      const msgs = evidence.samples
        .map((s) => `${s.type}: ${s.text}${s.location ? ` @ ${s.location}` : ""}`)
        .join(" | ");
      const fails = evidence.request_failures
        .map((r) => `${r.method} ${r.url} ${r.status ?? "ERR"}${r.error ? ` (${r.error})` : ""}`)
        .join(" | ");
      return `${msgs}${fails ? ` | ${fails}` : ""}`.trim();
    }
    if (evidence.kind === "mobile-responsive") {
      const parts = [
        `mobile=${evidence.mobile.width}px overflow=${evidence.mobile.overflow_px}px`,
        `desktop=${evidence.desktop.width}px overflow=${evidence.desktop.overflow_px}px`,
      ];
      if (evidence.tap_target_issues > 0) parts.push(`tap_issues=${evidence.tap_target_issues}`);
      return parts.join(" ");
    }
    if (evidence.kind === "aeo-render") {
      return `server=${evidence.server.text_length}chars dom=${evidence.rendered.text_length}chars ratio=${evidence.text_ratio} ${evidence.issues.join(" | ")}`;
    }
    if (evidence.kind === "browser-storage") {
      return evidence.entries
        .map((e) => `${e.store}:${e.key} ${e.kind}${e.secret_type ? `(${e.secret_type})` : ""} ${e.masked}`)
        .join(" | ");
    }
  }
  return `${evidence.request}\n${evidence.response}`;
}

const SEVERITY_BY_STATUS: Record<InlineCheckLike["status"], FindingSeverity> = {
  pass: "info",
  warn: "medium",
  fail: "high",
  info: "info",
};

const ISSUE_TITLES: Record<
  string,
  Partial<Record<"fail" | "warn", string>>
> = {
  reachability: {
    warn: "Site geeft een foutstatus",
    fail: "Site is niet bereikbaar",
  },
  https: {
    warn: "HTTPS verloopt niet volledig",
    fail: "HTTPS ontbreekt",
  },
  "security-header-csp": {
    fail: "Content-Security-Policy ontbreekt",
    warn: "Content-Security-Policy is zwak geconfigureerd",
  },
  "security-header-hsts": {
    fail: "HSTS ontbreekt",
    warn: "HSTS is zwak geconfigureerd",
  },
  "security-header-xcto": {
    warn: "X-Content-Type-Options ontbreekt of is niet 'nosniff'",
  },
  "security-header-xfo": {
    warn: "X-Frame-Options ontbreekt of is zwak geconfigureerd",
  },
  "security-header-referrer-policy": {
    warn: "Referrer-Policy ontbreekt of is onveilig",
  },
  "security-header-permissions-policy": {
    warn: "Permissions-Policy ontbreekt of is te breed",
  },
  "security-header-coop": {
    warn: "Cross-Origin-Opener-Policy ontbreekt of is unsafe-none",
  },
  "security-header-coep": {
    warn: "Cross-Origin-Embedder-Policy ontbreekt of is onveilig",
  },
  "cookie-httponly": {
    warn: "Cookie mist HttpOnly",
  },
  "cookie-secure": {
    warn: "Cookie mist Secure",
  },
  "cookie-samesite": {
    warn: "SameSite ontbreekt of is onveilig",
    fail: "SameSite=None zonder Secure (cookie wordt verworpen)",
  },
  "cookie-prefixes": {
    warn: "Cookie-prefix onjuist gebruikt",
  },
  "cookie-expiry": {
    warn: "Sessie-cookie is persistent",
  },
  "meta-tags": {
    warn: "Meta-tags onvolledig",
    fail: "Meta-tags onvolledig",
  },
  "secrets-in-bundles": {
    warn: "Mogelijke gelekte API-keys in JS-bundels",
    fail: "Gelekte API-keys in JS-bundels",
  },
  "secrets-in-html": {
    warn: "Mogelijke gelekte API-keys in inline HTML",
    fail: "Gelekte API-keys in inline HTML",
  },
  "mini-crawl": {
    warn: "Ontbrekende image-alt of orphan-pagina's gevonden",
    fail: "Ontbrekende image-alt of orphan-pagina's gevonden",
  },
  "repo-health": {
    warn: "Repo-health signaal(en) onvolledig",
    fail: "Default branch is niet beveiligd",
  },
  semgrep: {
    warn: "Semgrep vond middelzware SAST-issues",
    fail: "Semgrep vond kritieke SAST-issues",
  },
  gitleaks: {
    fail: "Gitleaks vond gelekte secrets in de repo",
  },
  "osv-scanner": {
    warn: "OSV-Scanner vond kwetsbare dependencies",
    fail: "OSV-Scanner vond kritieke dependency-kwetsbaarheden",
  },
  "core-web-vitals": {
    warn: "Core Web Vitals komen niet volledig in orde (needs improvement)",
    fail: "Een of meer Core Web Vitals zijn arm (poor)",
  },
  accessibility: {
    warn: "axe-core vond matige toegankelijkheidsissues",
    fail: "axe-core vond kritieke toegankelijkheidsissues",
  },
  "console-errors": {
    warn: "Console-warnings of failed netwerk-requests gevonden",
    fail: "Console-errors of failed netwerk-requests gevonden",
  },
  "mobile-responsive": {
    warn: "Mobiele viewport heeft overflow of te kleine tap-targets",
    fail: "Mobiele viewport heeft significante horizontale overflow",
  },
  "aeo-scan": {
    warn: "Kerncontent is deels afhankelijk van JavaScript",
    fail: "Kerncontent is zonder JavaScript niet zichtbaar (SPA-cloaking)",
  },
  cors: {
    warn: "CORS laat arbitraire origins toe",
    fail: "CORS reflecteert origins met credentials",
  },
  "aeo-engine-matrix": {
    warn: "AI-bots kunnen de site niet volledig bereiken of parsen",
    fail: "AI-bots zijn geblokkeerd voor de site",
  },
  "tls-cert": {
    warn: "TLS-certificaat of -ketting vereist aandacht",
    fail: "TLS-certificaat is verlopen of nog niet geldig",
  },
  "domain-watchtower": {
    warn: "Domein loopt binnen 30 dagen af of DNSSEC is uitgeschakeld",
    fail: "Domeinregistratie is verlopen",
  },
  "cookie-banner": {
    warn: "Geen (herkenbare) cookie-banner gevonden",
    fail: "Cookie-banner ontbreekt terwijl er wel cookies worden geplaatst",
  },
  "consent-api": {
    warn: "Geen consent-API gevonden",
    fail: "Consent-API ontbreekt terwijl de site scripts/cookies laadt",
  },
  "privacy-policy": {
    warn: "Geen privacy-policy-link gevonden",
    fail: "Privacy-policy is onbereikbaar",
  },
  "legal-pages": {
    warn: "Legal-pagina's onvolledig",
    fail: "Legal-pagina's ontbreken",
  },
  "gdpr-signals": {
    warn: "Geen GDPR-signalen gevonden",
    fail: "GDPR-signalen ontbreken",
  },
  "stack-detection": {
    warn: "Geen CMS/framework herkend",
    fail: "Geen CMS/framework herkend",
  },
  "hosting-security": {
    warn: "Platform-specifieke hosting-misconfiguratie",
    fail: "Platform-specifieke hosting-misconfiguratie",
  },
  "redirects-mixed": {
    warn: "Redirect of mixed content issue",
    fail: "Mixed content op https-pagina of final URL is niet HTTPS",
  },
  "subresources": {
    warn: "Externe subresources zonder SRI-integrity",
    fail: "Externe subresources zonder SRI-integrity",
  },
  "structured-data": {
    warn: "Structured data onvolledig of ongeldig",
    fail: "Ongeldig JSON-LD structured data blok",
  },
  "security-txt": {
    warn: "security.txt, favicon of 404-page onvolledig",
    fail: "security.txt mist verplichte velden of is verlopen",
  },
  "robots-sitemap": {
    warn: "robots.txt of sitemap is onvolledig",
    fail: "robots.txt of sitemap ontbreekt of is ongeldig",
  },
};

const REMEDIATION: Record<string, string> = {
  reachability:
    "Controleer of de server draait, of de DNS-records kloppen en of het domein verlengd is.",
  https:
    "Regel een TLS-certificaat (bijv. Let's Encrypt) en forceer HTTPS met een 301-redirect.",
  "security-header-csp":
    "Stel een Content-Security-Policy in (response-header of <meta>-tag) met een default-src; vermijd unsafe-inline/unsafe-eval en wildcards in script-src/style-src/default-src.",
  "security-header-hsts":
    "Zet Strict-Transport-Security met max-age van minimaal 31536000 en includeSubDomains (overweeg preload) op de webserver of reverse proxy.",
  "security-header-xcto":
    "Zet X-Content-Type-Options: nosniff op alle responses om MIME-sniffing te voorkomen.",
  "security-header-xfo":
    "Zet X-Frame-Options: DENY of SAMEORIGIN (of gebruik CSP frame-ancestors als moderne vervanger).",
  "security-header-referrer-policy":
    "Zet Referrer-Policy op een veilige waarde zoals strict-origin-when-cross-origin.",
  "security-header-permissions-policy":
    "Zet Permissions-Policy en beperk gevoelige features (camera, microfoon, geolocatie) tot (self) of een expliciete allowlist.",
  "security-header-coop":
    "Zet Cross-Origin-Opener-Policy: same-origin (of same-origin-allow-popups) om cross-origin window-manipulatie te beperken.",
  "security-header-coep":
    "Zet Cross-Origin-Embedder-Policy: require-corp (of credentialless) om cross-origin resource-lading te beheersen.",
  "cookie-httponly":
    "Zet HttpOnly op (sessie-)cookies zodat ze niet via JavaScript (document.cookie) uit te lezen zijn.",
  "cookie-secure":
    "Verstuur cookies alleen over HTTPS door het Secure-attribuut te zetten.",
  "cookie-samesite":
    "Zet SameSite op Lax of Strict; gebruik SameSite=None alleen samen met Secure.",
  "cookie-prefixes":
    "Gebruik __Host- (vereist Secure + Path=/ + geen Domain) of __Secure- (vereist Secure) alleen met de bijbehorende attributen.",
  "cookie-expiry":
    "Maak sessie-cookies niet persistent — laat Expires/Max-Age weg op sessie-cookies.",
  "meta-tags":
    "Voeg per pagina een unieke <title>, meta description en Open Graph-tags toe.",
  cors:
    "Beperk `Access-Control-Allow-Origin` tot een expliciete allowlist; reflecteer de `Origin`-header nooit onbewerkt; zet `Access-Control-Allow-Credentials: true` alleen op vertrouwde origins; sta `null` niet toe.",
  "aeo-engine-matrix":
    "Zorg dat AI-crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Bingbot, CCBot, MistralAI) de site mogen bereiken in robots.txt en niet door de WAF worden geblokkeerd; publiceer een llms.txt met geldige links; render kerncontent server-side zodat titel, headings en voldoende tekst zonder JavaScript zichtbaar zijn.",
  "tls-cert":
    "Verleng het TLS-certificaat tijdig (bijv. via Let's Encrypt met auto-renewal); zorg dat notAfter ≥ 30 d in de toekomst ligt en dat de SAN/CN overeenkomt met de hostnaam. Serveer de volledige ketting (leaf + intermediate) zodat de CA-store de ketting vertrouwt, en gebruik ALPN om HTTP/2 te onderhandelen.",
  "domain-watchtower":
    "Verleng de domeinregistratie tijdig (auto-renew aanzetten bij de registrar); schakel DNSSEC in; houd de nameservers stabiel en CAA-records restrictief; vernieuw het TLS-certificaat vóór de 14-dagen-runway.",
  "cookie-banner":
    "Implementeer een cookie-banner of CMP (bijv. OneTrust, Cookiebot, Usercentrics) die bezoekers een keuze geeft vóór het plaatsen van cookies.",
  "consent-api":
    "Implementeer een consent-API (bijv. IAB TCF via `__tcfapi`, Google consent mode via `googlefc`) zodat scripts pas laden na expliciete toestemming.",
  "privacy-policy":
    "Publiceer een privacy-policy-pagina (met contact-e-mail en last-updated-datum) en link er vanuit de footer.",
  "legal-pages":
    "Publiceer terms-of-service, imprint en een contactpagina en link ze vanuit de footer.",
  "gdpr-signals":
    "Voeg GDPR-signalen toe: een DSAR/data-verwijderingsverwijzing en een CMP/IAB-TCF-signaal zodat bezoekers hun rechten kunnen uitoefenen.",
  "stack-detection":
    "Informatief — geen actie vereist. Stacksignalen helpen bij het diagnosticeren van beveiligings- en SEO-problemen.",
  "hosting-security":
    "Verberg de origin-server achter het CDN (overschrijf de `server`-header via Cloudflare Transform/Response-Header Rules of Vercel/Netlify headers-config). Zet `cache-control: private` op geauthenticeerde documenten (vercel.json `headers` / netlify.toml `[[headers]]` / Cloudflare Rules) zodat sessie-content niet via gedeelde caches lekt. Scan de productie-URL, niet een publieke preview/branch-deploy.",
  "redirects-mixed":
    "Forceer HTTPS met een 301-redirect van http:// naar https://, en vervang alle http://-resources (scripts, stylesheets, images, iframes) door https://-equivalenten om mixed content te voorkomen.",
  "subresources":
    "Voeg een `integrity`-attribuut (SRI) toe aan externe <script>/<link rel=stylesheet>-tags met een sha384-hash, plus `crossorigin` voor cross-origin resources, zodat manipulatie door een derde partij wordt tegengegaan.",
  "structured-data":
    "Voeg geldig JSON-LD toe (<script type=\"application/ld+json\">) met een @type uit schema.org (bijv. Organization, WebSite, BreadcrumbList, Article) en valideer via de Rich Results Test van Google.",
  "security-txt":
    "Publiceer een /.well-known/security.txt volgens RFC 9116 met verplichte velden `Contact:` en `Expires:` (in de toekomst), plus een favicon op /favicon.ico en een custom 404-pagina met h1, zoekfunctie en een link naar de homepage.",
  "robots-sitemap":
    "Publiceer een /robots.txt met een `User-agent: *`-groep en geldige Disallow/Allow-regels, en verwijs via een `Sitemap:`-directive naar je sitemap. Publiceer een geldige sitemap.xml (urlset of sitemapindex) met alleen absolute http(s)-URL's naar bestaande pagina's, en houd de URL's in robots.txt en sitemap gesynchroniseerd met de daadwerkelijke site.",
  "secrets-in-html":
    "Verwijder het geheim uit de inline HTML/JS en roteer het direct (behandel het als gelekt). Plaats secrets server-side in omgevingsvariabelen of een secrets-manager en lever ze via een beveiligde API-endpoint, nooit inline in het HTML-document of in inline <script>-blokken.",
  "mini-crawl":
    "Voeg een beschrijvend `alt`-attribuut toe aan elke `<img>` (lege `alt=\"\"` alleen voor puur decoratieve images) voor toegankelijkheid en SEO. Zorg dat elke pagina in de sitemap vanaf minstens één andere pagina intern gelinkt is (voeg interne links toe of verwijder orphan-pagina's uit de sitemap).",
  "repo-health":
    "Beveilig de default branch (branch-protection met required reviews + enforce_admins), voeg een LICENSE en README toe, en configureer CI via .github/workflows. Schakel enforce_admins in zodat de regels ook voor admins gelden (MFA-proxy).",
  semgrep:
    "Los de SAST-issues op die Semgrep rapporteert (verving van gevaarlijke API's, input-validatie, pad-traversal, enz.). Behandel high-severity-issues als blockers; voeg Semgrep toe aan de CI om regressie te voorkomen.",
  gitleaks:
    "Verwijder het gelekte geheim uit de repo-geschiedenis (git filter-repo / BFG) en roteer het direct (behandel het als gelekt). Plaats secrets in een secrets-manager of omgevingsvariabelen, nooit in broncode of commits. Voeg gitleaks toe aan de CI als pre-commit/pre-push hook.",
  "osv-scanner":
    "Update de kwetsbare dependencies naar een niet-kwetsbare versie (zie het advisory-id in de evidence). Bij een onbeperkt advisary zonder patch: pin de versie, pas mitigaties toe of vervang de dependency. Voeg OSV-Scanner toe aan de CI voor continue controle.",
  "core-web-vitals":
    "Optimaliseer LCP (verlaag de largest render-time: pre-load van kritische resources, CDN, lazy-load niet-kritieke media), CLS (reserveer ruimte voor media/ad-banners, vermijd layout-shift door late inserts) en INP (verdeel lange taken, gebruik requestIdleCallback, optimaliseer interactie-handlers). Meet met Lighthouse / PageSpeed Insights / CrUX-field data.",
  accessibility:
    "Los de axe-core-violations op: voeg ontbrekende alt-attributen, labels, ARIA-roles, heading-volgorde, color-contrast en focus-management toe. Behandel critical/serious-issues als blockers; voeg axe toe aan de CI om regressie te voorkomen. Valideer met echte toetsenbord/schermlezer-tests.",
  "console-errors":
    "Los de JavaScript-console-errors op (uncaught exceptions, TypeError, ReferenceError) en de failed netwerk-requests (404, 500, CORS, timeout). Voeg een error-monitoring (bijv. Sentry) toe en monitor de console-output in CI met Playwright-traces om regressie vroeg te detecteren.",
  "mobile-responsive":
    "Zorg dat de layout op mobile (375px) geen horizontale overflow veroorzaakt: gebruik responsive units (rem, %, clamp), `overflow-x: hidden` waar nodig, `max-width: 100vw` op media en containers, en meta viewport-tag `width=device-width, initial-scale=1`. Vergroot tap-targets tot minimaal 24×24 CSS-pixels (WCAG 2.5.5) met padding en min-width/min-height.",
  "aeo-scan":
    "Render de kerncontent server-side (SSR/SSG of een static HTML-shell): titel, headings en de hoofdtekst moeten zonder JavaScript in de HTML staan, zodat AI-crawlers en LLM-parsers de pagina ook zonder JS-rendering kunnen begrijpen. Vermijd een lege SPA-shell die alles via client-side JavaScript injecteert. Publiceer de content tevens via llms.txt/JSON-LD voor betere AEO-detecteerbaarheid.",
};

/**
 * Zet checks uit de (tijdelijke) inline probe om naar het versioned
 * findings-formaat: pass → info, warn → medium, fail → high. Eén bron voor
 * de webapp-probe én de scheduler-probe; de BullMQ-workers (Fase 3) schrijven
 * direct hetzelfde formaat.
 *
 * Plan 54: `routeUrl` stempelt de finding met `route_url` én maakt de id
 * route-bewust (zodat dezelfde check op meerdere routes unieke ids krijgt —
 * geen collisions in het findings-array of de carry-over-map). Zonder `routeUrl`
 * (site-level checks, bijv. github) blijft de id ongewijzigd.
 */
export function inlineChecksToFindings(
  checks: InlineCheckLike[],
  now: string = new Date().toISOString(),
  routeUrl?: string | null,
): Finding[] {
  return checks.map((check) => {
    const title =
      check.status === "pass" || check.status === "info"
        ? check.name
        : (ISSUE_TITLES[check.id]?.[check.status] ?? check.name);
    const idScope = routeUrl ? `${check.id}@${routeUrl}` : check.id;
    return {
      id: findingId(idScope, title),
      check_id: check.id,
      category: checkById(check.id)?.category ?? "http",
      severity: check.severity ?? SEVERITY_BY_STATUS[check.status],
      title,
      description: check.detail,
      remediation:
        REMEDIATION[check.id] ??
        "Bekijk de beschrijving en los het probleem op.",
      evidence: check.evidence ?? null,
      active: check.active ?? false,
      status: "open",
      note: null,
      route_url: routeUrl ?? null,
      regressed: false,
      snooze_until: null,
      created_at: now,
    };
  });
}
