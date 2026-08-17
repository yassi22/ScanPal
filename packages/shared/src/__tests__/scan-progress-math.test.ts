import { describe, it, expect } from "vitest";
import {
  advanceProgressDetails,
  initialProgressDetails,
  overallProgress,
  summarizeFindings,
} from "../scan-progress-math";
import { overallScoreFromFindings } from "../scoring";
import { inlineChecksToFindings, type InlineCheckLike } from "../findings";

const NOW = "2026-08-17T09:00:00.000Z";

describe("initialProgressDetails (pipeline-variant)", () => {
  it("bouwt het skelet uit de per-categorie totalen", () => {
    const details = initialProgressDetails({ http: 4, seo: 1 }, NOW);

    expect(details.checks_total).toBe(5);
    expect(details.checks_done).toBe(0);
    expect(details.categories.http).toMatchObject({
      status: "pending",
      done: 0,
      total: 4,
      percent: 0,
      current_check: null,
    });
    expect(details.categories.seo).toMatchObject({ total: 1 });
    expect(details.categories.aeo).toMatchObject({ total: 0 });
    expect(details.categories.github).toMatchObject({ total: 0 });
    expect(details.categories.compliance).toMatchObject({ total: 0 });
    expect(details.updated_at).toBe(NOW);
  });

  it("laat ontbrekende categorieën op 0 staan (github zonder repo)", () => {
    const details = initialProgressDetails({ http: 3 }, NOW);
    expect(details.categories.github!.total).toBe(0);
    expect(details.checks_total).toBe(3);
  });

  it("klemt negatieve/gebroken totalen af", () => {
    const details = initialProgressDetails({ http: -2, seo: 2.7 }, NOW);
    expect(details.categories.http!.total).toBe(0);
    expect(details.categories.seo!.total).toBe(2);
  });
});

describe("advanceProgressDetails (queue-modus)", () => {
  it("loopt monotoon op naar 100% over alle categorieën", () => {
    let details = initialProgressDetails({ http: 4, seo: 1 }, NOW);
    const progress: number[] = [overallProgress(details)];
    const checkIds = [
      "reachability",
      "https",
      "security-header-csp",
      "secrets-in-bundles",
      "meta-tags",
    ];

    for (const checkId of checkIds) {
      details = advanceProgressDetails(details, checkId, NOW);
      progress.push(overallProgress(details));
    }

    expect(progress).toEqual([0, 20, 40, 60, 80, 100]);
    expect(details.categories.http!.status).toBe("done");
    expect(details.categories.seo!.status).toBe("done");
    expect(details.checks_done).toBe(5);
  });

  it("zet current_check op de zojuist voltooide check (parallel, besluit 4)", () => {
    let details = initialProgressDetails({ http: 4, seo: 1 }, NOW);
    details = advanceProgressDetails(details, "https", NOW);

    expect(details.categories.http).toMatchObject({
      status: "running",
      done: 1,
      total: 4,
      percent: 25,
      current_check: "HTTPS",
    });

    details = advanceProgressDetails(details, "secrets-in-bundles", NOW);
    expect(details.categories.http!.current_check).toBe("Secrets in JS-bundles");
  });

  it("kan in willekeurige volgorde voltooien zonder verlies (parallel)", () => {
    let details = initialProgressDetails({ http: 4, seo: 1 }, NOW);
    details = advanceProgressDetails(details, "meta-tags", NOW);
    details = advanceProgressDetails(details, "https", NOW);
    details = advanceProgressDetails(details, "security-header-csp", NOW);
    details = advanceProgressDetails(details, "reachability", NOW);
    details = advanceProgressDetails(details, "secrets-in-bundles", NOW);

    expect(details.checks_done).toBe(5);
    expect(details.categories.http!.status).toBe("done");
    expect(details.categories.seo!.status).toBe("done");
    expect(overallProgress(details)).toBe(100);
  });

  it("is idempotent voor onbekende check-ids", () => {
    let details = initialProgressDetails({ http: 4 }, NOW);
    details = advanceProgressDetails(details, "bestaat-niet", NOW);
    expect(details.checks_done).toBe(0);
  });

  it("is een no-op voor een al-afgeronde categorie", () => {
    let details = initialProgressDetails({ http: 1 }, NOW);
    details = advanceProgressDetails(details, "reachability", NOW);
    const before = JSON.stringify(details);

    details = advanceProgressDetails(details, "reachability", NOW);
    expect(JSON.stringify(details)).toBe(before);
  });

  it("laat een categorie met total 0 nooit vorderen", () => {
    let details = initialProgressDetails({ http: 1 }, NOW);
    details = advanceProgressDetails(details, "meta-tags", NOW);
    expect(details.categories.aeo).toMatchObject({ done: 0, total: 0 });
    expect(details.categories.seo).toMatchObject({ done: 0, total: 0 });
  });
});

describe("overallProgress", () => {
  it("geeft 0 bij geen checks", () => {
    expect(overallProgress(initialProgressDetails({}, NOW))).toBe(0);
  });
});

describe("summarizeFindings", () => {
  it("telt severity uit het versioned findings-payload zonder actieve tests", () => {
    const findings = {
      v: 1,
      items: [
        { id: "a", check_id: "a", category: "http", severity: "critical", title: "A", description: "", remediation: "", evidence: null, status: "open", note: null, created_at: NOW },
        { id: "b", check_id: "b", category: "http", severity: "high", title: "B", description: "", remediation: "", evidence: null, status: "open", note: null, created_at: NOW },
        { id: "c", check_id: "c", category: "http", severity: "high", title: "C", description: "", remediation: "", evidence: null, status: "open", note: null, created_at: NOW },
        { id: "d", check_id: "d", category: "http", severity: "medium", title: "D", description: "", remediation: "", evidence: null, status: "open", note: null, created_at: NOW },
        { id: "e", check_id: "e", category: "http", severity: "info", title: "E", description: "", remediation: "", evidence: null, status: "open", note: null, created_at: NOW },
        { id: "f", check_id: "f", category: "http", severity: "high", title: "F", description: "", remediation: "", evidence: null, status: "open", note: null, created_at: NOW, active: true },
      ],
    };
    expect(summarizeFindings(findings)).toEqual({
      critical: 1,
      high: 2,
      medium: 1,
      low: 0,
      info: 1,
    });
  });

  it("geeft nullen voor legacy-data en lege payloads", () => {
    expect(summarizeFindings({ checks: [] })).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(summarizeFindings({})).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });
});

describe("overallScoreFromFindings", () => {
  it("rekent de pass-ratio over niet-actieve findings", () => {
    const checks: InlineCheckLike[] = [
      { id: "reachability", name: "Reachability", status: "pass", detail: "" },
      { id: "https", name: "HTTPS", status: "fail", detail: "" },
      { id: "meta-tags", name: "Meta & OG-tags", status: "warn", detail: "" },
      { id: "sqli-probe", name: "SQL-injection probe", status: "pass", detail: "", active: true },
    ];
    const findings = inlineChecksToFindings(checks, NOW);
    expect(overallScoreFromFindings(findings)).toBe(33);
  });

  it("geeft 0 zonder scorable findings", () => {
    expect(overallScoreFromFindings([])).toBe(0);
  });
});