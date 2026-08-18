import {
  checkById,
  parseViewportIssues,
  parseTapTargetIssues,
  responsiveEvidence,
  responsiveOverallStatus,
  type ResponsiveEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Feature 45 — Mobile/responsive basis-check (category aeo, homepage-only).
 * Laadt de pagina op mobile (375×667) en desktop (1280×720) viewports via de
 * injectable BrowserRunner en meet horizontale overflow + tap-target-grootte.
 * Status: fail bij significante mobile-overflow (>8px), warn bij tap-target-
 * issues of desktop-overflow, anders pass.
 */
export function createMobileResponsiveCheck(runner: BrowserRunner): CheckImplementation {
  return {
    id: "mobile-responsive",
    category: "aeo",
    async run(ctx) {
      const name = checkById("mobile-responsive")?.name ?? "Mobile / responsive";

      const rate = await ctx.rateLimit(`responsive:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return [
          {
            id: "mobile-responsive",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — responsive-capture niet uitgevoerd",
          },
        ];
      }

      const res = await runner.captureResponsive(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "mobile-responsive",
            name,
            status: "warn",
            detail: `Responsive-capture mislukt: ${res.error}`,
          },
        ];
      }

      const mobile = parseViewportIssues(res.capture.mobile);
      const desktop = parseViewportIssues(res.capture.desktop);
      if (!mobile || !desktop) {
        return [
          {
            id: "mobile-responsive",
            name,
            status: "warn",
            detail: "Responsive-capture retourneerde onvolledige viewport-data",
          },
        ];
      }

      const capture = {
        mobile,
        desktop,
        tap_target_issues: parseTapTargetIssues(res.capture.tap_target_issues),
      };
      const status = responsiveOverallStatus(capture);
      const evidence: ResponsiveEvidence = responsiveEvidence(capture);

      const detail =
        evidence.issues.length === 0
          ? `Mobile ${mobile.width}px en desktop ${desktop.width}px zonder layout-issues.`
          : evidence.issues.join("; ") + ".";

      return [
        {
          id: "mobile-responsive",
          name,
          status,
          detail,
          evidence,
        },
      ];
    },
  };
}
