import { describe, it, expect } from "vitest";
import {
  rateLcp,
  rateCls,
  rateInp,
  rateAll,
  cwvOverallStatus,
  cwvEvidence,
  cwvEvidenceSchema,
} from "../browser-vitals";
import { checkCatalog } from "../check-catalog";

describe("browser-vitals (feature 41)", () => {
  it("heeft de catalog-entry core-web-vitals (categorie aeo, passief)", () => {
    const entry = checkCatalog.find((c) => c.id === "core-web-vitals");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("aeo");
    expect(entry?.active).toBe(false);
  });

  describe("rateLcp", () => {
    it("good ≤ 2500, needs-improvement 2501-4000, poor > 4000", () => {
      expect(rateLcp(1000)).toBe("good");
      expect(rateLcp(2500)).toBe("good");
      expect(rateLcp(2501)).toBe("needs-improvement");
      expect(rateLcp(4000)).toBe("needs-improvement");
      expect(rateLcp(4001)).toBe("poor");
    });

    it("null → unknown", () => {
      expect(rateLcp(null)).toBe("unknown");
    });
  });

  describe("rateCls", () => {
    it("good ≤ 0.1, needs-improvement 0.11-0.25, poor > 0.25", () => {
      expect(rateCls(0)).toBe("good");
      expect(rateCls(0.1)).toBe("good");
      expect(rateCls(0.11)).toBe("needs-improvement");
      expect(rateCls(0.25)).toBe("needs-improvement");
      expect(rateCls(0.26)).toBe("poor");
    });

    it("null → unknown", () => {
      expect(rateCls(null)).toBe("unknown");
    });
  });

  describe("rateInp", () => {
    it("good ≤ 200, needs-improvement 201-500, poor > 500", () => {
      expect(rateInp(100)).toBe("good");
      expect(rateInp(200)).toBe("good");
      expect(rateInp(201)).toBe("needs-improvement");
      expect(rateInp(500)).toBe("needs-improvement");
      expect(rateInp(501)).toBe("poor");
    });

    it("null → unknown", () => {
      expect(rateInp(null)).toBe("unknown");
    });
  });

  describe("rateAll", () => {
    it("rate alle drie de metrics", () => {
      const r = rateAll({ lcp_ms: 1000, cls: 0.05, inp_ms: 100 });
      expect(r).toEqual({ lcp: "good", cls: "good", inp: "good" });
    });

    it("null metrics → unknown", () => {
      const r = rateAll({ lcp_ms: null, cls: null, inp_ms: null });
      expect(r).toEqual({ lcp: "unknown", cls: "unknown", inp: "unknown" });
    });
  });

  describe("cwvOverallStatus", () => {
    const good = { lcp: "good" as const, cls: "good" as const, inp: "good" as const };

    it("pass als alles good is", () => {
      expect(cwvOverallStatus(good)).toBe("pass");
    });

    it("warn bij needs-improvement (rest good)", () => {
      expect(cwvOverallStatus({ ...good, lcp: "needs-improvement" })).toBe("warn");
    });

    it("fail bij een poor-metric", () => {
      expect(cwvOverallStatus({ ...good, cls: "poor" })).toBe("fail");
    });

    it("pass bij unknown (rest good) — unknown triggert geen warn/fail", () => {
      expect(cwvOverallStatus({ ...good, inp: "unknown" })).toBe("pass");
    });
  });

  describe("cwvEvidence", () => {
    it("bouwt evidence met metrics + ratings", () => {
      const ev = cwvEvidence({ lcp_ms: 3000, cls: 0.15, inp_ms: 250 });
      expect(ev.kind).toBe("core-web-vitals");
      expect(ev.lcp_ms).toBe(3000);
      expect(ev.ratings.lcp).toBe("needs-improvement");
      expect(ev.ratings.cls).toBe("needs-improvement");
      expect(ev.ratings.inp).toBe("needs-improvement");
      expect(cwvEvidenceSchema.safeParse(ev).success).toBe(true);
    });

    it("null metrics worden bewaard in evidence", () => {
      const ev = cwvEvidence({ lcp_ms: null, cls: null, inp_ms: null });
      expect(ev.lcp_ms).toBeNull();
      expect(ev.ratings.lcp).toBe("unknown");
      expect(cwvEvidenceSchema.safeParse(ev).success).toBe(true);
    });
  });
});
