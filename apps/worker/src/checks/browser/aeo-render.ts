import {
  checkById,
  parseRenderCompare,
  renderCompareEvidence,
  renderOverallStatus,
  type RenderCompareEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Feature 43 — AEO JS-rendered content check (catalog id `aeo-scan`, category
 * aeo, homepage-only). Vergelijkt server-gerenderde HTML met de JS-gerenderde
 * DOM via de injectable BrowserRunner (`captureRenderCompare`). Status: fail
 * bij een SPA-shell of ≥10×-tekst-ratio, warn bij ≥3×-ratio of JS-only-
 * headings/title/meta, anders pass (LLM-parsability zonder JavaScript).
 */
export function createAeoRenderCheck(runner: BrowserRunner): CheckImplementation {
  return {
    id: "aeo-scan",
    category: "aeo",
    async run(ctx) {
      const name = checkById("aeo-scan")?.name ?? "AEO-content & LLM-parsability";

      const rate = await ctx.rateLimit(`aeo-render:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return [
          {
            id: "aeo-scan",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — render-vergelijking niet uitgevoerd",
          },
        ];
      }

      const res = await runner.captureRenderCompare(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "aeo-scan",
            name,
            status: "warn",
            detail: `Render-vergelijking mislukt: ${res.error}`,
          },
        ];
      }

      // Runner retourneert reeds geparseerde capture, maar parse opnieuw ter
      // verdediging tegen een onverwachte runner-implementatie (schema-mock).
      const capture = parseRenderCompare(res.capture);
      if (!capture) {
        return [
          {
            id: "aeo-scan",
            name,
            status: "warn",
            detail: "Render-vergelijking retourneerde onvolledige data",
          },
        ];
      }

      const status = renderOverallStatus(capture);
      const evidence: RenderCompareEvidence = renderCompareEvidence(capture);
      const { server, rendered } = capture;

      const detail =
        status === "pass"
          ? `Server-HTML ${server.text_length} tekens vs gerenderde DOM ${rendered.text_length} tekens — kerncontent is zonder JavaScript beschikbaar.`
          : evidence.issues.join("; ") + ".";

      return [
        {
          id: "aeo-scan",
          name,
          status,
          detail,
          evidence,
        },
      ];
    },
  };
}
