import {
  checkById,
  classifyStorage,
  storageEntrySeverity,
  type BrowserStorageEvidence,
  type InlineCheckLike,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Browser storage & session-token scanner (plan 70). Passief: leest
 * `localStorage`/`sessionStorage` na één page-load via de injectable
 * BrowserRunner. Geen interactie (klikt/logt niet in). Waarden worden
 * gemaskeerd (nooit de volledige token in evidence/DB/logs).
 *
 * Severity (plan 70, besluit 3):
 * - critical — service-role/private-key/sk_live_-achtig materiaal in storage.
 * - high — overige secrets (anon-key, publishable key, …).
 * - medium — JWT met langlopende/afwezige exp in localStorage.
 * - low — session-token in localStorage i.p.v. HttpOnly-cookie.
 * - info — storage aanwezig maar niets gevoeligs; of lege storage.
 */
export function createBrowserStorageCheck(
  runner: BrowserRunner,
): CheckImplementation {
  return {
    id: "browser-storage",
    category: "aeo",
    async run(ctx) {
      const name =
        checkById("browser-storage")?.name ?? "Browser storage & session-tokens";

      const rate = await ctx.rateLimit(
        `browser-storage:${new URL(ctx.url).hostname}`,
        5,
        60,
      );
      if (!rate.ok) {
        return [
          {
            id: "browser-storage",
            name,
            status: "info",
            detail: `Storage-capture niet uitgevoerd: rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`,
          },
        ];
      }

      const res = await runner.captureStorage(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "browser-storage",
            name,
            status: "info",
            detail: `Storage-capture mislukt: ${res.error}`,
          },
        ];
      }

      const entries = classifyStorage(res.snapshot);
      const evidence: BrowserStorageEvidence = {
        kind: "browser-storage",
        entries,
      };

      if (entries.length === 0) {
        return [
          {
            id: "browser-storage",
            name,
            status: "info",
            detail: "Geen localStorage/sessionStorage-entries gevonden.",
            evidence,
          },
        ];
      }

      // Hoogste severity bepalen.
      const severityRank = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
        info: 0,
      } as const;
      let topSeverity: "critical" | "high" | "medium" | "low" | "info" = "info";
      for (const entry of entries) {
        const sev = storageEntrySeverity(entry);
        if (severityRank[sev] > severityRank[topSeverity]) {
          topSeverity = sev;
        }
      }

      const status: InlineCheckLike["status"] =
        topSeverity === "critical" || topSeverity === "high"
          ? "fail"
          : topSeverity === "medium" || topSeverity === "low"
            ? "warn"
            : "info";

      const counts = {
        secret: entries.filter((e) => e.kind === "secret").length,
        jwt: entries.filter((e) => e.kind === "jwt").length,
        "session-token": entries.filter((e) => e.kind === "session-token").length,
        other: entries.filter((e) => e.kind === "other").length,
      };

      const detail =
        `${entries.length} storage-entries ` +
        `(secret=${counts.secret}, jwt=${counts.jwt}, session-token=${counts["session-token"]}, other=${counts.other}). ` +
        `Hoogste severity: ${topSeverity}.`;

      return [
        {
          id: "browser-storage",
          name,
          status,
          // Severity-override (zoals secrets-in-bundles): behoud de critical-tier
          // uit storageEntrySeverity i.p.v. de default fail->high-mapping, zodat
          // service-role/private-key-materiaal als critical wordt weggeschreven.
          severity: topSeverity,
          detail,
          evidence,
        },
      ];
    },
  };
}
