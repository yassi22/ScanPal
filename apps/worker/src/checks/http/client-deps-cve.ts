import {
  checkById,
  detectClientDeps,
  clientDepsEvidence,
  clientDepsStatus,
  queryOsvBatch,
  extractScriptSrc,
  type ClientDepsEvidence,
  type InlineCheckLike,
  type OsvBatchQuery,
  type OsvVulnerability,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 71 — client-side dependencies & CVE (category http, passief). Haalt de
 * homepage op, herkent JS-libs + versies uit script-URL's via `detectClientDeps`
 * (CDN-patronen) en matcht ze batched tegen OSV (api.osv.dev). Werkt op URL-only
 * sites — geen GitHub-repo nodig — en vult zo het gat dat `osv-scanner` laat
 * vallen. Eén batched OSV-call per scan; per-host rate-limit op api.osv.dev.
 *
 * Finding-regels: alleen een finding bij een versie-bevestigde match; severity
 * spiegelt de OSV/CVSS-severity. De check claimt geen exploitabiliteit, alleen
 * dat een kwetsbare versie geladen wordt.
 */
export function createClientDepsCveCheck(
  deps: { queryOsv?: typeof queryOsvBatch } = {},
): CheckImplementation {
  const queryOsv = deps.queryOsv ?? queryOsvBatch;

  return {
    id: "client-deps-cve",
    category: "http",
    async run(ctx): Promise<InlineCheckLike[]> {
      const name = checkById("client-deps-cve")?.name ?? "Client-side dependencies & CVE";

      let html = "";
      try {
        const fetcher = ctx.fetchPage ?? fetchPage;
        const page = await fetcher(ctx.url, { timeoutMs: 10_000 });
        const contentType = page.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          html = await page.text();
        }
      } catch {
        html = "";
      }
      if (!html) {
        return [
          {
            id: "client-deps-cve",
            name,
            status: "info",
            detail: "Geen HTML-pagina — client-side dependencies niet controleerbaar",
          },
        ];
      }

      const scriptUrls = extractScriptSrc(html, ctx.url);
      const detected = detectClientDeps(scriptUrls);
      if (detected.length === 0) {
        return [
          {
            id: "client-deps-cve",
            name,
            status: "pass",
            detail: "Geen client-side JS-libraries herkend via CDN-URL-patronen.",
          },
        ];
      }

      const rate = await ctx.rateLimit("client-deps:api.osv.dev", 10, 60);
      if (!rate.ok) {
        return [
          {
            id: "client-deps-cve",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — OSV-lookup niet uitgevoerd",
          },
        ];
      }

      const queries: OsvBatchQuery[] = detected.map((d) => ({
        package: { name: d.package, ecosystem: "npm" },
        version: d.version,
      }));
      const results: OsvVulnerability[][] = await queryOsv(queries);
      const evidence: ClientDepsEvidence = clientDepsEvidence(detected, results);
      const status = clientDepsStatus(evidence.vulnerable, evidence.by_severity);

      const detail =
        evidence.vulnerable === 0
          ? `${detected.length} client-side library/libraries herkend, geen bekende kwetsbaarheden.`
          : `${evidence.vulnerable} van ${detected.length} herkende client-side libraries hebben bekende kwetsbaarheden ` +
            `(critical=${evidence.by_severity.critical}, high=${evidence.by_severity.high}, medium=${evidence.by_severity.medium}, low=${evidence.by_severity.low}).`;

      return [
        {
          id: "client-deps-cve",
          name,
          status,
          detail,
          evidence: evidence.vulnerable > 0 ? evidence : null,
        },
      ];
    },
  };
}
