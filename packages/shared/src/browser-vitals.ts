import { z } from "zod";

/**
 * Feature 41 — Core Web Vitals (category aeo). Pure logica voor het bepalen van
 * de scores (LCP/CLS/INP) volgens de Google-debuckets ("good"/"needs
 * improvement"/"poor"). De worker-wrapper in
 * `apps/worker/src/checks/browser/core-web-vitals.ts` haalt de metrics via een
 * injectable BrowserRunner (Playwright-default) en voert ze aan deze helpers.
 *
 * Besluiten (drempels conform web.dev/vitals, 2024):
 * - LCP (ms): good ≤ 2500, poor > 4000.
 * - CLS (unitless): good ≤ 0.1, poor > 0.25.
 * - INP (ms): good ≤ 200, poor > 500.
 * - Eén veld-metric mist → overall = "unknown", geen fail.
 * - Overall-status: fail bij een poor-metric, warn bij needs-improvement.
 */

export type CwvRating = "good" | "needs-improvement" | "poor";

export type CwvMetrics = {
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
};

export const cwvMetricsSchema = z.object({
  lcp_ms: z.number().nullable(),
  cls: z.number().nullable(),
  inp_ms: z.number().nullable(),
});

const LCP_THRESHOLDS = { good: 2500, poor: 4000 } as const;
const CLS_THRESHOLDS = { good: 0.1, poor: 0.25 } as const;
const INP_THRESHOLDS = { good: 200, poor: 500 } as const;

export function rateLcp(lcpMs: number | null): CwvRating | "unknown" {
  if (lcpMs === null || !Number.isFinite(lcpMs)) return "unknown";
  if (lcpMs <= LCP_THRESHOLDS.good) return "good";
  if (lcpMs > LCP_THRESHOLDS.poor) return "poor";
  return "needs-improvement";
}

export function rateCls(cls: number | null): CwvRating | "unknown" {
  if (cls === null || !Number.isFinite(cls)) return "unknown";
  if (cls <= CLS_THRESHOLDS.good) return "good";
  if (cls > CLS_THRESHOLDS.poor) return "poor";
  return "needs-improvement";
}

export function rateInp(inpMs: number | null): CwvRating | "unknown" {
  if (inpMs === null || !Number.isFinite(inpMs)) return "unknown";
  if (inpMs <= INP_THRESHOLDS.good) return "good";
  if (inpMs > INP_THRESHOLDS.poor) return "poor";
  return "needs-improvement";
}

export type CwvRatings = {
  lcp: CwvRating | "unknown";
  cls: CwvRating | "unknown";
  inp: CwvRating | "unknown";
};

export function rateAll(metrics: CwvMetrics): CwvRatings {
  return {
    lcp: rateLcp(metrics.lcp_ms),
    cls: rateCls(metrics.cls),
    inp: rateInp(metrics.inp_ms),
  };
}

/** Overall-status: fail bij een poor-metric, warn bij needs-improvement. */
export function cwvOverallStatus(ratings: CwvRatings): "pass" | "warn" | "fail" {
  const vals = [ratings.lcp, ratings.cls, ratings.inp];
  if (vals.includes("poor")) return "fail";
  if (vals.includes("needs-improvement")) return "warn";
  return "pass";
}

export const cwvEvidenceSchema = z.object({
  kind: z.literal("core-web-vitals"),
  lcp_ms: z.number().nullable(),
  cls: z.number().nullable(),
  inp_ms: z.number().nullable(),
  ratings: z.object({
    lcp: z.enum(["good", "needs-improvement", "poor", "unknown"]),
    cls: z.enum(["good", "needs-improvement", "poor", "unknown"]),
    inp: z.enum(["good", "needs-improvement", "poor", "unknown"]),
  }),
});
export type CwvEvidence = z.infer<typeof cwvEvidenceSchema>;

export function cwvEvidence(metrics: CwvMetrics): CwvEvidence {
  const ratings = rateAll(metrics);
  return {
    kind: "core-web-vitals",
    lcp_ms: metrics.lcp_ms,
    cls: metrics.cls,
    inp_ms: metrics.inp_ms,
    ratings,
  };
}
