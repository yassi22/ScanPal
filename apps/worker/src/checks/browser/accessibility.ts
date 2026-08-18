import {
  checkById,
  parseAxeViolations,
  axeEvidence,
  axeOverallStatus,
  type AxeEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Feature 42 — Accessibility-scan (category aeo, homepage-only). Draait axe-core
 * via de injectable BrowserRunner (Playwright-default) en normaliseert de
 * violations[] via `parseAxeViolations`. Status: critical/serious → fail,
 * moderate/minor → warn, anders pass.
 */
export function createAccessibilityCheck(runner: BrowserRunner): CheckImplementation {
  return {
    id: "accessibility",
    category: "aeo",
    async run(ctx) {
      const name = checkById("accessibility")?.name ?? "Accessibility (axe-core)";

      const rate = await ctx.rateLimit(`axe:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return [
          {
            id: "accessibility",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — accessibility-scan niet uitgevoerd",
          },
        ];
      }

      const res = await runner.runAxe(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "accessibility",
            name,
            status: "warn",
            detail: `axe-run mislukt: ${res.error}`,
          },
        ];
      }

      const violations = parseAxeViolations(res.violations);
      const status = axeOverallStatus(violations);
      const evidence: AxeEvidence = axeEvidence(violations);
      const by = evidence.by_impact;

      const detail =
        violations.length === 0
          ? "Geen axe-core-violations gevonden."
          : `${violations.length} violation(s) ` +
            `(critical=${by.critical}, serious=${by.serious}, moderate=${by.moderate}, minor=${by.minor}).`;

      return [
        {
          id: "accessibility",
          name,
          status,
          detail,
          evidence,
        },
      ];
    },
  };
}
