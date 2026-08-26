import {
  classifyObservability,
  detectObservabilityBeacons,
  detectReportingHeaders,
  observabilityEvidence,
  parseSecurityTxt,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/**
 * Plan 79 — observability-signalen (G11 herdefinieerd). Hergebruikt de
 * homepage-fetch (headers + HTML) voor reporting-headers + RUM/error-
 * tracking-beacons; leest security.txt (RFC 9116, plan 37) alleen voor het
 * Contact-veld als extra signaal — geen dubbele severity-beoordeling, dat
 * blijft bij de `security-txt`-check. Altijd informatief: afwezigheid van
 * signalen levert nooit meer dan `low`/info op (zie `classifyObservability`).
 */
export const observabilitySignalsCheck: CheckImplementation = {
  id: "observability-signals",
  category: "http",
  async run(ctx) {
    try {
      const response = await (ctx.fetchPage ?? fetchPage)(ctx.url, {
        timeoutMs: 10000,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const html = contentType.includes("text/html") ? await response.text() : "";

      const reportingHeaders = detectReportingHeaders(response.headers);
      const beacons = detectObservabilityBeacons(html);

      let securityTxtContact = false;
      const origin = originOf(ctx.url);
      try {
        const rate = await ctx.rateLimit(`observability-signals:${origin}`, 30, 60);
        if (rate.ok) {
          const secResponse = await fetchPage(`${origin}/.well-known/security.txt`, {
            timeoutMs: 8000,
          });
          const secText = await secResponse.text();
          securityTxtContact = parseSecurityTxt(secText).contact !== null;
        }
      } catch {
        securityTxtContact = false;
      }

      const signals = {
        reporting_headers: reportingHeaders,
        beacons,
        security_txt: securityTxtContact,
      };
      const { status, severity, detail } = classifyObservability(signals);

      return [
        {
          id: "observability-signals",
          name: "Observability & monitoring-signalen",
          status,
          severity,
          detail,
          evidence: observabilityEvidence(signals),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "observability-signals",
          name: "Observability & monitoring-signalen",
          status: "warn",
          // Besluit 3: nooit medium/high, ook niet bij een fetch-fout — dit is
          // altijd informatief, nooit een score-straf.
          severity: "low",
          detail: `Observability-signalen niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};
