import {
  checkById,
  detectRuntimeDeps,
  clientDepsEvidence,
  clientDepsStatus,
  queryOsvBatch,
  type ClientDepsEvidence,
  type InlineCheckLike,
  type OsvBatchQuery,
  type OsvVulnerability,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Plan 71 v2 — client-side dependencies via runtime-globals (category aeo,
 * browser-queue, passief). Leest window-globals van bekende JS-libs in één
 * page-load via de injectable BrowserRunner en matcht de versies batched tegen
 * OSV. Hardere versiebewijzen dan de statische URL-parsing van
 * `client-deps-cve` (http-queue): vangt ook libs zonder versie in de CDN-URL
 * (bijv. een gebundelde React via `window.React.version`).
 *
 * Eigen check-id `client-deps-runtime` zodat findings niet samenvallen met de
 * statische check; de evidence `source` is `runtime-global`. Werkt op URL-only
 * sites (geen repo nodig). Eén batched OSV-call per scan; per-host rate-limit op
 * api.osv.dev. Claimt geen exploitabiliteit, alleen dat een kwetsbare versie
 * geladen wordt.
 */
export function createClientDepsRuntimeCheck(
  runner: BrowserRunner,
  deps: { queryOsv?: typeof queryOsvBatch } = {},
): CheckImplementation {
  const queryOsv = deps.queryOsv ?? queryOsvBatch;

  return {
    id: "client-deps-runtime",
    category: "aeo",
    async run(ctx): Promise<InlineCheckLike[]> {
      const name =
        checkById("client-deps-runtime")?.name ?? "Client-side dependencies (runtime)";

      const rate = await ctx.rateLimit("client-deps:api.osv.dev", 10, 60);
      if (!rate.ok) {
        return [
          {
            id: "client-deps-runtime",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — OSV-lookup niet uitgevoerd",
          },
        ];
      }

      const res = await runner.captureClientDeps(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "client-deps-runtime",
            name,
            status: "info",
            detail: `Runtime-deps-capture mislukt: ${res.error}`,
          },
        ];
      }

      const detected = detectRuntimeDeps(res.capture);
      if (detected.length === 0) {
        return [
          {
            id: "client-deps-runtime",
            name,
            status: "pass",
            detail: "Geen bekende JS-libs met versie gevonden via window-globals.",
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
          ? `${detected.length} client-side library/libraries bevestigd via runtime-globals, geen bekende kwetsbaarheden.`
          : `${evidence.vulnerable} van ${detected.length} via runtime-globals bevestigde libraries hebben bekende kwetsbaarheden ` +
            `(critical=${evidence.by_severity.critical}, high=${evidence.by_severity.high}, medium=${evidence.by_severity.medium}, low=${evidence.by_severity.low}).`;

      return [
        {
          id: "client-deps-runtime",
          name,
          status,
          detail,
          evidence: evidence.vulnerable > 0 ? evidence : null,
        },
      ];
    },
  };
}
