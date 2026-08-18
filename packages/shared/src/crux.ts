import { z } from "zod";

/**
 * Plan 62 — CrUX field data (real-user CWV naast lab-metingen).
 *
 * De Chrome UX Report (CrUX)-API levert per vital de p75-waarde en de
 * good/needs-improvement/poor-fracties van echte Chrome-gebruikers. De
 * http-worker schrijft het resultaat in `scans.crux` (besluit 2: geen eigen
 * tabel); de aggregator berekent de lab/field-divergentie met de pure
 * functies hieronder. Geen data (laag verkeer, nieuw domein) → `crux: null`
 * + info-finding, geen score-straf (besluit 3).
 */

export const cruxMetricSchema = z.object({
  p75: z.number().nullable(),
  good: z.number().min(0).max(1).nullable(),
  needs_improvement: z.number().min(0).max(1).nullable(),
  poor: z.number().min(0).max(1).nullable(),
});
export type CruxMetric = z.infer<typeof cruxMetricSchema>;

export const cruxMetricsSchema = z.object({
  lcp: cruxMetricSchema,
  inp: cruxMetricSchema,
  cls: cruxMetricSchema,
});
export type CruxMetrics = z.infer<typeof cruxMetricsSchema>;

export const cruxDataSchema = z.object({
  origin: z.string(),
  /** Meest recente CrUX-collectieperiode, als "YYYY-MM". */
  collection_period: z.string(),
  metrics: cruxMetricsSchema,
});
export type CruxData = z.infer<typeof cruxDataSchema>;

export const cruxEvidenceSchema = z.object({
  kind: z.literal("crux-field-data"),
  data: cruxDataSchema,
});
export type CruxEvidence = z.infer<typeof cruxEvidenceSchema>;

/** Eén geconstateerde lab/field-divergentie per vital (besluit 4). */
export const cruxDivergenceSchema = z.object({
  vital: z.enum(["lcp", "inp", "cls"]),
  /** Lab-waarde (ms voor lcp/inp, unitless voor cls). */
  lab_value: z.number().nullable(),
  /** Field-p75 (ms voor lcp/inp, unitless voor cls). */
  field_value: z.number().nullable(),
  threshold: z.number(),
  /** Lab − field (positief = lab is slechter dan de werkelijkheid). */
  delta: z.number(),
});
export type CruxDivergence = z.infer<typeof cruxDivergenceSchema>;

export const cruxDivergenceEvidenceSchema = z.object({
  kind: z.literal("crux-divergence"),
  lab: z.object({
    lcp_ms: z.number().nullable(),
    cls: z.number().nullable(),
    inp_ms: z.number().nullable(),
  }),
  field: cruxDataSchema,
  divergences: z.array(cruxDivergenceSchema),
});
export type CruxDivergenceEvidence = z.infer<typeof cruxDivergenceEvidenceSchema>;

export type LabCwv = {
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
};

/** Drempels uit het plan (besluit 4): lab vs field verschil per vital. */
export const CRUX_DIVERGENCE_THRESHOLDS = {
  lcpMs: 1000,
  inpMs: 200,
  cls: 0.1,
} as const;

export const CRUX_VITAL_LABELS: Record<CruxDivergence["vital"], string> = {
  lcp: "LCP",
  inp: "INP",
  cls: "CLS",
};

/**
 * Lab/field-divergentie per vital (besluit 4): `|lab − field p75|` boven de
 * drempel (LCP > 1s, INP > 200ms, CLS > 0,1) → divergentie. Lab of field
 * ontbreekt (geen CrUX-dekking / geen browser-meting) → geen divergentie.
 */
export function computeCruxDivergences(
  lab: LabCwv | null,
  crux: CruxData | null,
): CruxDivergence[] {
  if (!lab || !crux) return [];
  const divergences: CruxDivergence[] = [];
  const field = crux.metrics;

  if (lab.lcp_ms !== null && field.lcp.p75 !== null) {
    const delta = lab.lcp_ms - field.lcp.p75;
    if (Math.abs(delta) > CRUX_DIVERGENCE_THRESHOLDS.lcpMs) {
      divergences.push({
        vital: "lcp",
        lab_value: lab.lcp_ms,
        field_value: field.lcp.p75,
        threshold: CRUX_DIVERGENCE_THRESHOLDS.lcpMs,
        delta,
      });
    }
  }
  if (lab.inp_ms !== null && field.inp.p75 !== null) {
    const delta = lab.inp_ms - field.inp.p75;
    if (Math.abs(delta) > CRUX_DIVERGENCE_THRESHOLDS.inpMs) {
      divergences.push({
        vital: "inp",
        lab_value: lab.inp_ms,
        field_value: field.inp.p75,
        threshold: CRUX_DIVERGENCE_THRESHOLDS.inpMs,
        delta,
      });
    }
  }
  if (lab.cls !== null && field.cls.p75 !== null) {
    const delta = lab.cls - field.cls.p75;
    if (Math.abs(delta) > CRUX_DIVERGENCE_THRESHOLDS.cls) {
      divergences.push({
        vital: "cls",
        lab_value: lab.cls,
        field_value: field.cls.p75,
        threshold: CRUX_DIVERGENCE_THRESHOLDS.cls,
        delta,
      });
    }
  }
  return divergences;
}
