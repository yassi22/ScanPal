import {
  checkById,
  cwvEvidence,
  cwvOverallStatus,
  rateAll,
  type CwvEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Feature 41 — Core Web Vitals check (category aeo, homepage-only). De check-
 * factory neemt een `BrowserRunner` (injectable): tests geven een vi.fn()-runner
 * mee, de worker-runtime geeft `createPlaywrightRunner()`. Status: fail bij een
 * poor-metric, warn bij needs-improvement, pass als alles good is.
 */
export function createCoreWebVitalsCheck(runner: BrowserRunner): CheckImplementation {
  return {
    id: "core-web-vitals",
    category: "aeo",
    async run(ctx) {
      const name = checkById("core-web-vitals")?.name ?? "Core Web Vitals";

      const rate = await ctx.rateLimit(`cwv:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return [
          {
            id: "core-web-vitals",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — Core Web Vitals niet uitgevoerd",
          },
        ];
      }

      const res = await runner.captureVitals(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "core-web-vitals",
            name,
            status: "warn",
            detail: `Browser-run mislukt: ${res.error}`,
          },
        ];
      }

      const ratings = rateAll(res.metrics);
      const status = cwvOverallStatus(ratings);
      const evidence: CwvEvidence = cwvEvidence(res.metrics);

      const parts: string[] = [];
      if (res.metrics.lcp_ms !== null) parts.push(`LCP=${res.metrics.lcp_ms}ms (${ratings.lcp})`);
      if (res.metrics.cls !== null) parts.push(`CLS=${res.metrics.cls} (${ratings.cls})`);
      if (res.metrics.inp_ms !== null) parts.push(`INP=${res.metrics.inp_ms}ms (${ratings.inp})`);

      const detail =
        parts.length === 0
          ? "Geen Core Web Vitals-metrics beschikbaar."
          : parts.join(", ") + ".";

      return [
        {
          id: "core-web-vitals",
          name,
          status,
          detail,
          evidence,
        },
      ];
    },
  };
}
