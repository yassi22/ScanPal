import { describe, it, expect } from "vitest";
import {
  categoryScoresFromFindings,
  categoryScoresSchema,
  overallScoreFromFindings,
  type Finding,
} from "../index";

const NOW = "2026-08-15T09:00:00.000Z";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "check:title",
    check_id: "check",
    category: "http",
    severity: "info",
    title: "Title",
    description: "Beschrijving",
    remediation: "Los het op",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    created_at: NOW,
    route_url: null,
    regressed: false,
    snooze_until: null,
    ...overrides,
  };
}

describe("categoryScoresSchema", () => {
  it("accepteert geldige scores incl. null per categorie", () => {
    expect(
      categoryScoresSchema.safeParse({
        http: 100,
        seo: 33,
        aeo: null,
        github: 0,
        compliance: 100,
      }).success,
    ).toBe(true);
  });

  it("vult compliance met null voor oude scans zonder sleutel (backward-compat)", () => {
    const parsed = categoryScoresSchema.safeParse({
      http: 100,
      seo: 33,
      aeo: null,
      github: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.compliance).toBeNull();
    }
  });

  it("weigert scores buiten 0–100 of niet-null", () => {
    expect(
      categoryScoresSchema.safeParse({
        http: 101,
        seo: 33,
        aeo: null,
        github: 0,
        compliance: null,
      }).success,
    ).toBe(false);
    expect(
      categoryScoresSchema.safeParse({
        http: 50.5,
        seo: 33,
        aeo: null,
        github: 0,
        compliance: null,
      }).success,
    ).toBe(false);
  });
});

describe("categoryScoresFromFindings", () => {
  it("berekent de pass-ratio per categorie (info / totaal × 100)", () => {
    const scores = categoryScoresFromFindings([
      makeFinding({ category: "http", severity: "info" }),
      makeFinding({ category: "http", severity: "info" }),
      makeFinding({ category: "http", severity: "high" }),
      makeFinding({ category: "seo", severity: "info" }),
    ]);
    expect(scores).toEqual({
      http: 67,
      seo: 100,
      aeo: null,
      github: null,
      compliance: null,
    });
  });

  it("geeft null voor een categorie zonder checks", () => {
    const scores = categoryScoresFromFindings([
      makeFinding({ category: "http", severity: "info" }),
    ]);
    expect(scores.http).toBe(100);
    expect(scores.seo).toBeNull();
    expect(scores.aeo).toBeNull();
    expect(scores.github).toBeNull();
    expect(scores.compliance).toBeNull();
  });

  it("excludeert actieve-test-findings (plan 52)", () => {
    const scores = categoryScoresFromFindings([
      makeFinding({ category: "http", severity: "high", active: true }),
      makeFinding({ category: "http", severity: "critical", active: true }),
    ]);
    expect(scores.http).toBeNull();
  });
});

describe("overallScoreFromFindings (compliance-gewicht, plan 61)", () => {
  it("weegt compliance mee met 10% naast de rest-categorieën", () => {
    // rest: 3 pass → 100; compliance: 1 pass van 2 → 50
    // overall = 100 * 0.9 + 50 * 0.1 = 95
    const scores = [
      makeFinding({ category: "http", severity: "info" }),
      makeFinding({ category: "http", severity: "info" }),
      makeFinding({ category: "seo", severity: "info" }),
      makeFinding({ category: "compliance", severity: "info" }),
      makeFinding({ category: "compliance", severity: "high" }),
    ];
    expect(overallScoreFromFindings(scores)).toBe(95);
  });

  it("is ongewijzigd zonder compliance-findings (rest-ratio)", () => {
    const scores = [
      makeFinding({ category: "http", severity: "info" }),
      makeFinding({ category: "http", severity: "high" }),
      makeFinding({ category: "seo", severity: "info" }),
    ];
    expect(overallScoreFromFindings(scores)).toBe(67);
  });

  it("gebruikt alleen de compliance-ratio als er geen rest-findings zijn", () => {
    const scores = [
      makeFinding({ category: "compliance", severity: "info" }),
      makeFinding({ category: "compliance", severity: "info" }),
      makeFinding({ category: "compliance", severity: "medium" }),
    ];
    expect(overallScoreFromFindings(scores)).toBe(67);
  });

  it("telt actieve-test-findings niet mee in de compliance-ratio", () => {
    const scores = [
      makeFinding({ category: "http", severity: "info" }),
      makeFinding({ category: "compliance", severity: "high", active: true }),
    ];
    expect(overallScoreFromFindings(scores)).toBe(100);
  });
});