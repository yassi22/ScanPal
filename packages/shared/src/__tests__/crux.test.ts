import { describe, it, expect } from "vitest";
import {
  computeCruxDivergences,
  cruxDataSchema,
  cruxDivergenceEvidenceSchema,
  cruxEvidenceSchema,
  type CruxData,
  type LabCwv,
} from "../crux";

const SAMPLE_CRUX: CruxData = {
  origin: "https://example.com",
  collection_period: "2026-07",
  metrics: {
    lcp: { p75: 2100, good: 0.7, needs_improvement: 0.2, poor: 0.1 },
    inp: { p75: 180, good: 0.8, needs_improvement: 0.15, poor: 0.05 },
    cls: { p75: 0.05, good: 0.85, needs_improvement: 0.1, poor: 0.05 },
  },
};

const SAMPLE_LAB: LabCwv = { lcp_ms: 2200, inp_ms: 150, cls: 0.03 };

describe("cruxDataSchema (contract)", () => {
  it("valideert een volledig cruxData-object", () => {
    expect(cruxDataSchema.safeParse(SAMPLE_CRUX).success).toBe(true);
  });

  it("verwerpt ontbrekende metrics", () => {
    const { metrics: _metrics, ...rest } = SAMPLE_CRUX;
    expect(cruxDataSchema.safeParse(rest).success).toBe(false);
  });

  it("verwerpt fracties buiten 0..1", () => {
    const bad = {
      ...SAMPLE_CRUX,
      metrics: { ...SAMPLE_CRUX.metrics, lcp: { ...SAMPLE_CRUX.metrics.lcp, good: 1.5 } },
    };
    expect(cruxDataSchema.safeParse(bad).success).toBe(false);
  });
});

describe("cruxEvidenceSchema / cruxDivergenceEvidenceSchema", () => {
  it("valideert de crux-field-data evidence", () => {
    const evidence = { kind: "crux-field-data", data: SAMPLE_CRUX };
    expect(cruxEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it("valideert de crux-divergence evidence met beide waarden", () => {
    const evidence = {
      kind: "crux-divergence",
      lab: SAMPLE_LAB,
      field: SAMPLE_CRUX,
      divergences: [
        {
          vital: "lcp",
          lab_value: 3600,
          field_value: 2100,
          threshold: 1000,
          delta: 1500,
        },
      ],
    };
    expect(cruxDivergenceEvidenceSchema.safeParse(evidence).success).toBe(true);
  });
});

describe("computeCruxDivergences (besluit 4)", () => {
  it("geen divergentie bij vergelijkbare waarden", () => {
    expect(computeCruxDivergences(SAMPLE_LAB, SAMPLE_CRUX)).toEqual([]);
  });

  it("LCP-verschil > 1s → lcp-divergentie (lab slechter)", () => {
    const lab: LabCwv = { ...SAMPLE_LAB, lcp_ms: 3600 };
    const divergences = computeCruxDivergences(lab, SAMPLE_CRUX);
    expect(divergences).toHaveLength(1);
    expect(divergences[0].vital).toBe("lcp");
    expect(divergences[0].lab_value).toBe(3600);
    expect(divergences[0].field_value).toBe(2100);
    expect(divergences[0].delta).toBe(1500);
  });

  it("LCP-verschil > 1s → lcp-divergentie (lab beter dan field)", () => {
    const lab: LabCwv = { ...SAMPLE_LAB, lcp_ms: 800 };
    const divergences = computeCruxDivergences(lab, SAMPLE_CRUX);
    expect(divergences).toHaveLength(1);
    expect(divergences[0].delta).toBe(-1300);
  });

  it("INP-verschil > 200ms → inp-divergentie", () => {
    const lab: LabCwv = { ...SAMPLE_LAB, inp_ms: 450 };
    const divergences = computeCruxDivergences(lab, SAMPLE_CRUX);
    expect(divergences).toHaveLength(1);
    expect(divergences[0].vital).toBe("inp");
  });

  it("CLS-verschil > 0.1 → cls-divergentie", () => {
    const lab: LabCwv = { ...SAMPLE_LAB, cls: 0.2 };
    const divergences = computeCruxDivergences(lab, SAMPLE_CRUX);
    expect(divergences).toHaveLength(1);
    expect(divergences[0].vital).toBe("cls");
  });

  it("meerdere vitals tegelijk", () => {
    const lab: LabCwv = { lcp_ms: 5000, inp_ms: 800, cls: 0.4 };
    const divergences = computeCruxDivergences(lab, SAMPLE_CRUX);
    expect(divergences.map((d) => d.vital).sort()).toEqual(["cls", "inp", "lcp"]);
  });

  it("exact op de drempel → geen divergentie", () => {
    const lab: LabCwv = { ...SAMPLE_LAB, lcp_ms: 3100 };
    expect(computeCruxDivergences(lab, SAMPLE_CRUX)).toEqual([]);
  });

  it("geen lab of geen field → geen divergentie", () => {
    expect(computeCruxDivergences(null, SAMPLE_CRUX)).toEqual([]);
    expect(computeCruxDivergences(SAMPLE_LAB, null)).toEqual([]);
  });

  it("null-waarden in lab of field → overslaan", () => {
    const lab: LabCwv = { lcp_ms: null, inp_ms: 150, cls: 0.03 };
    expect(computeCruxDivergences(lab, SAMPLE_CRUX)).toEqual([]);
  });
});
