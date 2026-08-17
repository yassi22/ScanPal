import {
  analyzeRedirect,
  evaluateRedirectsMixed,
  findMixedContent,
  redirectsMixedEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 32 — redirects & mixed content. Fetch met redirect: "follow" levert
 * finalUrl + redirected-flag; daarna mixed content-scan op de HTML. De exacte
 * redirect-chain (intermediate hops) is met fetch niet direct beschikbaar;
 * later uit te breiden met manual-redirect-follow. Eén check-id `redirects-mixed`.
 */
export const redirectsMixedCheck: CheckImplementation = {
  id: "redirects-mixed",
  category: "http",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const finalUrl = response.url || ctx.url;
      const analysis = analyzeRedirect(ctx.url, finalUrl);
      const contentType = response.headers.get("content-type") ?? "";
      const html = contentType.includes("text/html") ? await response.text() : "";
      const mixedContent = findMixedContent(html, finalUrl);
      const { status, detail } = evaluateRedirectsMixed(analysis, mixedContent);
      return [
        {
          id: "redirects-mixed",
          name: "Redirects & mixed content",
          status,
          detail,
          evidence: redirectsMixedEvidence(analysis, mixedContent, [ctx.url, finalUrl]),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "redirects-mixed",
          name: "Redirects & mixed content",
          status: "fail",
          detail: `Redirects/mixed content niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};
