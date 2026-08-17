import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
  advanceProgressDetails,
  initialProgressDetails,
  overallProgress,
  summarizeFindings,
  updateScanProgress,
} from "../scan-progress";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));

const NOW = "2026-08-15T09:00:00.000Z";

describe("initialProgressDetails", () => {
  it("bouwt een skelet uit de catalogus-totalen per categorie", () => {
    const details = initialProgressDetails(
      { http: 4, seo: 1 },
      NOW,
    );

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
    expect(details.updated_at).toBe(NOW);
  });
});

describe("advanceProgressDetails (queue-modus: current_check = zojuist voltooid)", () => {
  it("loopt monotoon op naar 100% per voltooide check", () => {
    let details = initialProgressDetails({ http: 2, seo: 1 }, NOW);
    const progress: number[] = [overallProgress(details)];

    for (const checkId of ["reachability", "https", "meta-tags"]) {
      details = advanceProgressDetails(details, checkId, NOW);
      progress.push(overallProgress(details));
    }

    expect(progress).toEqual([0, 33, 67, 100]);
    expect(details.categories.http!.status).toBe("done");
    expect(details.categories.seo!.status).toBe("done");
    expect(details.checks_done).toBe(3);
  });

  it("toont in current_check de zojuist voltooide check (parallelle checks)", () => {
    let details = initialProgressDetails({ http: 4 }, NOW);
    details = advanceProgressDetails(details, "reachability", NOW);

    expect(details.categories.http).toMatchObject({
      status: "running",
      done: 1,
      total: 4,
      percent: 25,
      current_check: "Reachability",
    });

    details = advanceProgressDetails(details, "https", NOW);
    expect(details.categories.http!.current_check).toBe("HTTPS");

    details = advanceProgressDetails(details, "security-header-csp", NOW);
    expect(details.categories.http).toMatchObject({
      status: "running",
      done: 3,
      total: 4,
      percent: 75,
      current_check: "Content-Security-Policy (CSP)",
    });

    details = advanceProgressDetails(details, "secrets-in-bundles", NOW);
    expect(details.categories.http).toMatchObject({
      status: "done",
      done: 4,
      percent: 100,
      current_check: null,
    });
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

  it("raakt categorieën zonder checks niet aan", () => {
    let details = initialProgressDetails({ http: 1 }, NOW);
    details = advanceProgressDetails(details, "meta-tags", NOW);
    expect(details.categories.aeo).toMatchObject({ done: 0, total: 0 });
  });
});

describe("updateScanProgress", () => {
  it("doet één atomische UPDATE van progress + progress_details", async () => {
    const queries: { text: string; params: unknown[] }[] = [];
    const db = {
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        return { rowCount: 1, rows: [] };
      },
    } as unknown as Pool;

    const details = initialProgressDetails({ http: 4 }, NOW);
    await updateScanProgress(db, "scan-1", { progress: 25, progressDetails: details });

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("update scans set progress");
    expect(queries[0].text).toContain("progress_details");
    expect(queries[0].params[0]).toBe("scan-1");
    expect(queries[0].params[1]).toBe(25);
    expect(JSON.parse(queries[0].params[2] as string)).toEqual(details);
  });
});

describe("summarizeFindings", () => {
  it("telt severity uit het versioned findings-payload", () => {
    const summary = summarizeFindings({
      v: 1,
      items: [
        {
          id: "a:crit",
          check_id: "a",
          category: "http",
          severity: "critical",
          title: "A",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
        {
          id: "b:high",
          check_id: "b",
          category: "http",
          severity: "high",
          title: "B",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
        {
          id: "c:high",
          check_id: "c",
          category: "http",
          severity: "high",
          title: "C",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
        {
          id: "d:medium",
          check_id: "d",
          category: "http",
          severity: "medium",
          title: "D",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
        {
          id: "e:info",
          check_id: "e",
          category: "http",
          severity: "info",
          title: "E",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
      ],
    });

    expect(summary).toEqual({
      critical: 1,
      high: 2,
      medium: 1,
      low: 0,
      info: 1,
    });
  });

  it("telt actieve-test-findings niet mee (plan 52)", () => {
    const summary = summarizeFindings({
      v: 1,
      items: [
        {
          id: "x:sql",
          check_id: "sqli-probe",
          category: "http",
          severity: "high",
          title: "SQLi",
          description: "",
          remediation: "",
          evidence: null,
          active: true,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
      ],
    });

    expect(summary.high).toBe(0);
  });

  it("geeft nullen voor findings zonder v1-payload (legacy)", () => {
    expect(
      summarizeFindings({ checks: [{ status: "fail" }, { status: "pass" }] }),
    ).toEqual({
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