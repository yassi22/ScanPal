import { z } from "zod";
import type { HeaderSource } from "./stack-detection";

/**
 * Plan 79 — Observability-signalen (G11 herdefinieerd). Pure logica (geen fetch):
 * de worker levert de al-gefetchte response-headers + HTML/script-tekst en of er
 * een security.txt bestaat; deze module detecteert **extern-zichtbare**
 * monitoring-signalen (reporting-headers, RUM/error-tracking-beacons, security.txt).
 *
 * Kernbesluit (plan 79, besluit 3/4): dit is een informatief, positief signaal.
 * Afwezigheid van signalen levert nooit een straf-severity op en bewijst niets
 * over server-side audit-logging (dat is van buitenaf onzichtbaar). Zowel
 * aanwezigheid als afwezigheid produceren daarom een `info`-severity finding —
 * de check telt in de pass-ratio altijd als pass, dus ontbrekende telemetrie
 * verlaagt de score niet.
 */

export type ObservabilitySignals = {
  /** Namen van gedetecteerde reporting-headers (Report-To/NEL/Reporting-Endpoints/CSP reporting). */
  reporting_headers: string[];
  /** Namen van gedetecteerde RUM/error-tracking-vendors. */
  beacons: string[];
  /** Of er een /.well-known/security.txt aanwezig is (rapportagekanaal-signaal). */
  security_txt: boolean;
};

export const observabilityEvidenceSchema = z.object({
  kind: z.literal("observability"),
  reporting_headers: z.array(z.string()),
  beacons: z.array(z.string()),
  security_txt: z.boolean(),
});
export type ObservabilityEvidence = z.infer<typeof observabilityEvidenceSchema>;

/**
 * RUM/error-tracking-vendors met lowercase-substrings die ze verraden in HTML,
 * inline scripts of script-src-URL's. Uitbreidbaar (plan 79, open vraag 2).
 */
export const OBSERVABILITY_VENDORS: { name: string; markers: string[] }[] = [
  { name: "Sentry", markers: ["sentry-cdn", "@sentry", "sentry.init", "browser.sentry"] },
  { name: "Datadog RUM", markers: ["datadoghq", "dd_rum", "datadog-rum"] },
  { name: "LogRocket", markers: ["logrocket"] },
  { name: "Bugsnag", markers: ["bugsnag"] },
  { name: "New Relic Browser", markers: ["nr-data.net", "newrelic", "nreum"] },
  { name: "Rollbar", markers: ["rollbar"] },
];

/**
 * Detecteert reporting-headers die bewijzen dat de site client-side fouten láát
 * rapporteren. Leest alleen aanwezigheid (geen waarden), zodat er niets
 * gevoeligs in de evidence belandt.
 */
export function detectReportingHeaders(headers: HeaderSource): string[] {
  const found: string[] = [];
  if (headers.get("report-to")) found.push("Report-To");
  if (headers.get("reporting-endpoints")) found.push("Reporting-Endpoints");
  if (headers.get("nel")) found.push("NEL");
  const csp = (headers.get("content-security-policy") ?? "").toLowerCase();
  if (csp.includes("report-uri") || csp.includes("report-to")) {
    found.push("CSP reporting");
  }
  return found;
}

/**
 * Detecteert bekende RUM/error-tracking-beacons uit HTML/inline-scripts/script-src.
 * Dedupliceert per vendor (meerdere markers → één naam).
 */
export function detectBeacons(text: string): string[] {
  const haystack = text.toLowerCase();
  const found: string[] = [];
  for (const vendor of OBSERVABILITY_VENDORS) {
    if (vendor.markers.some((marker) => haystack.includes(marker))) {
      found.push(vendor.name);
    }
  }
  return found;
}

/** Combineert de losse detectoren tot één signalen-object (worker-gemak). */
export function collectObservabilitySignals(
  headers: HeaderSource,
  text: string,
  securityTxt: boolean,
): ObservabilitySignals {
  return {
    reporting_headers: detectReportingHeaders(headers),
    beacons: detectBeacons(text),
    security_txt: securityTxt,
  };
}

function signalLabels(signals: ObservabilitySignals): string[] {
  return [
    ...signals.reporting_headers,
    ...signals.beacons,
    ...(signals.security_txt ? ["security.txt"] : []),
  ];
}

/**
 * Beoordeelt de signalen. Severity is **altijd** `info` — aanwezigheid is een
 * positief signaal (`pass`), afwezigheid een neutrale info-regel met disclaimer.
 * Nooit `low`/`medium`/`high`, zodat ontbrekende telemetrie de score niet straft
 * (plan 79, besluit 3/4).
 */
export function classifyObservability(signals: ObservabilitySignals): {
  status: "pass" | "info";
  detail: string;
  severity: "info";
} {
  const labels = signalLabels(signals);
  if (labels.length > 0) {
    return {
      status: "pass",
      severity: "info",
      detail: `Observability-signalen gedetecteerd: ${labels.join(", ")}. Extern-zichtbare aanwijzing dat de site client-side fouten/monitoring rapporteert.`,
    };
  }
  return {
    status: "info",
    severity: "info",
    detail:
      "Geen extern-zichtbare observability-signalen (reporting-headers, RUM/error-tracking-beacons, security.txt) gedetecteerd. Dit bewijst NIET dat er geen audit-logging is — server-side logging is van buitenaf onzichtbaar. Informatief signaal; geen score-straf.",
  };
}

export function observabilityEvidence(
  signals: ObservabilitySignals,
): ObservabilityEvidence {
  return {
    kind: "observability",
    reporting_headers: signals.reporting_headers,
    beacons: signals.beacons,
    security_txt: signals.security_txt,
  };
}
