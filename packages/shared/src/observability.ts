import { z } from "zod";
import type { HeaderSource } from "./stack-detection";

/**
 * Plan 79 — observability-signalen (G11 herdefinieerd). Pure logica (geen
 * fetch): de worker levert de al-gefetchte response-headers + HTML +
 * security.txt-Contact-signaal aan; deze module detecteert extern-zichtbare
 * observability-signalen (reporting-headers, RUM/error-tracking-beacons) en
 * classificeert ze. Uitdrukkelijk GEEN claim over interne/server-side
 * audit-logging — afwezigheid van signalen bewijst niets (zie
 * `classifyObservability`).
 */

export type ObservabilitySignals = {
  reporting_headers: string[];
  beacons: string[];
  security_txt: boolean;
};

export const observabilityEvidenceSchema = z.object({
  kind: z.literal("observability-signals"),
  reporting_headers: z.array(z.string()),
  beacons: z.array(z.string()),
  security_txt: z.boolean(),
});
export type ObservabilityEvidence = z.infer<typeof observabilityEvidenceSchema>;

/**
 * Bekende RUM/error-tracking-vendors, gedetecteerd uit HTML/script-URL's —
 * zelfde substring-matchpatroon als `stack-detection`. Uitbreidbaar.
 */
const RUM_VENDORS: { id: string; name: string; markers: string[] }[] = [
  {
    id: "sentry",
    name: "Sentry",
    markers: ["sentry-cdn.com", "browser.sentry-cdn.com", "@sentry/browser", "sentry.init("],
  },
  {
    id: "datadog-rum",
    name: "Datadog RUM",
    markers: ["datadoghq-browser-agent", "browser-intake-datadoghq", "dd_rum"],
  },
  {
    id: "logrocket",
    name: "LogRocket",
    markers: ["cdn.lr-ingest.io", "cdn.logrocket.io", "logrocket.init("],
  },
  {
    id: "bugsnag",
    name: "Bugsnag",
    markers: ["d2wy8f7a9ursnm.cloudfront.net", "@bugsnag/js", "bugsnag.start("],
  },
  {
    id: "newrelic-browser",
    name: "New Relic Browser",
    markers: ["js-agent.newrelic.com", "nreum"],
  },
  {
    id: "rollbar",
    name: "Rollbar",
    markers: ["cdn.rollbar.com", "rollbar.init("],
  },
];

/**
 * Detecteert CSP `report-uri`/`report-to`-directives en de losse
 * `Report-To`/`NEL`-headers. Alleen extern-zichtbare aanwijzingen dat de site
 * client-side fouten laat rapporteren — geen claim over wat er mee gebeurt.
 */
export function detectReportingHeaders(headers: HeaderSource): string[] {
  const found: string[] = [];
  // Enforcing CSP en Report-Only zijn twee losse headers die allebei
  // reporting-directives kunnen dragen (bijv. een strikte CSP zonder
  // reporting + een aparte Report-Only-policy mét report-uri) — allebei
  // lezen i.p.v. de eerst-aanwezige kiezen, anders mist de tweede.
  const csp = [
    headers.get("content-security-policy") ?? "",
    headers.get("content-security-policy-report-only") ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (/(?:^|;)\s*report-uri\b/.test(csp)) found.push("csp-report-uri");
  if (/(?:^|;)\s*report-to\b/.test(csp)) found.push("csp-report-to");
  if (headers.get("report-to")) found.push("report-to-header");
  if (headers.get("nel")) found.push("nel-header");
  return found;
}

/**
 * Detecteert bekende RUM/error-tracking-beacons in HTML (script-URL's +
 * inline init-calls). Puur substring-matchen, geen netwerk.
 */
export function detectObservabilityBeacons(html: string): string[] {
  const lowerHtml = html.toLowerCase();
  const found: string[] = [];
  for (const vendor of RUM_VENDORS) {
    if (vendor.markers.some((marker) => lowerHtml.includes(marker))) {
      found.push(vendor.name);
    }
  }
  return found;
}

export function observabilityEvidence(signals: ObservabilitySignals): ObservabilityEvidence {
  return {
    kind: "observability-signals",
    reporting_headers: signals.reporting_headers,
    beacons: signals.beacons,
    security_txt: signals.security_txt,
  };
}

/**
 * Classificeert de gevonden signalen. Kernbesluit (plan 79, besluit 3): dit is
 * altijd informatief. Aanwezigheid → `info`/pass. Afwezigheid → `low`/info,
 * NOOIT `medium`/`high` — server-side audit-logging is per definitie
 * onzichtbaar van buitenaf, dus afwezigheid van client-side telemetrie bewijst
 * niets over of er gelogd wordt.
 */
export function classifyObservability(signals: ObservabilitySignals): {
  status: "pass" | "info";
  severity: "info" | "low";
  detail: string;
} {
  const found: string[] = [];
  if (signals.reporting_headers.length > 0) {
    found.push(`reporting-headers: ${signals.reporting_headers.join(", ")}`);
  }
  if (signals.beacons.length > 0) {
    found.push(`error-tracking/RUM: ${signals.beacons.join(", ")}`);
  }
  if (signals.security_txt) {
    found.push("security.txt met Contact-veld");
  }

  if (found.length > 0) {
    return {
      status: "pass",
      severity: "info",
      detail: `Site rapporteert client-side fouten/observability via: ${found.join("; ")}.`,
    };
  }

  return {
    status: "info",
    severity: "low",
    detail:
      "Geen extern-zichtbare monitoring-signalen gedetecteerd — dit bewijst NIET dat er geen audit-logging is; server-side logging is van buitenaf onzichtbaar.",
  };
}
