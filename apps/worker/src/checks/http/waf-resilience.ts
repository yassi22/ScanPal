import {
  detectWafCdn,
  evaluateWafResilience,
  inspectRateLimitHeaders,
  wafResilienceEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Plan 73 — WAF/CDN-weerbaarheid & API-rate-limit-inspectie (G7), passieve helft.
 * Hergebruikt de homepage-fetch (één request, geen extra outbound calls) en
 * voert de pure `detectWafCdn` + `inspectRateLimitHeaders`-helpers uit op de
 * response-headers. Eén site-level finding (route_url null in de scan-worker).
 * Beoordeelt andere signalen dan plan 69 (hosting-fingerprint): WAF-aanwezigheid
 * en rate-limit, niet cache-hygiëne/origin-lek/preview-URL.
 */
export const wafResilienceCheck: CheckImplementation = {
  id: "waf-resilience",
  category: "http",
  async run(ctx) {
    try {
      const response = await (ctx.fetchPage ?? fetchPage)(ctx.url, {
        timeoutMs: 10000,
      });
      const fp = detectWafCdn(response.headers);
      const rl = inspectRateLimitHeaders(response.headers);
      const status429 = response.status === 429;
      const { status, detail, severity } = evaluateWafResilience(fp, rl, status429);
      return [
        {
          id: "waf-resilience",
          name: "WAF/CDN-weerbaarheid & rate-limit",
          status,
          detail,
          severity,
          evidence: wafResilienceEvidence(fp, rl, status429),
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "waf-resilience",
          name: "WAF/CDN-weerbaarheid & rate-limit",
          status: "warn",
          detail: `WAF/rate-limit-inspectie niet uitvoerbaar: ${message}`,
        },
      ];
    }
  },
};
