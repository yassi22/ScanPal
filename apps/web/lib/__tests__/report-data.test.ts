import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
  buildReportData,
  reportFilename,
  sortBySeverityCap,
} from "@/lib/report/data";
import type { Finding } from "@scanpal/shared";
import { makeFinding } from "./report-fixtures";

vi.mock("server-only", () => ({}));

function fakePool(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: rows.length, rows }),
  } as unknown as Pool;
}

const COMPLETED_ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "completed",
  score: 80,
  findings: {
    v: 1,
    items: [
      makeFinding({ id: "a:1", severity: "high", category: "http" }),
      makeFinding({ id: "b:2", severity: "info", category: "http" }),
    ],
  },
  trigger: "manual",
  created_at: new Date("2026-08-15T08:00:00.000Z"),
  completed_at: new Date("2026-08-15T09:00:00.000Z"),
  site_id: "00000000-0000-4000-8000-000000000002",
  site_url: "example.com",
  site_label: null,
};

describe("buildReportData", () => {
  it("geeft not_found voor een scan buiten het team (geen existence-leak)", async () => {
    const result = await buildReportData(fakePool([]), "scan-1", "team-1");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("geeft not_completed + status voor een non-completed scan", async () => {
    const result = await buildReportData(
      fakePool([{ id: "scan-1", status: "running" }]),
      "scan-1",
      "team-1",
    );
    expect(result).toEqual({ ok: false, reason: "not_completed", status: "running" });
  });

  it("bouwt één ReportData-object uit een completed scan (scores, sortering, datums)", async () => {
    const result = await buildReportData(fakePool([COMPLETED_ROW]), "scan-1", "team-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.siteId).toBe("00000000-0000-4000-8000-000000000002");
    expect(result.data.score).toBe(80);
    expect(result.data.category_scores).toEqual({
      http: 50,
      seo: null,
      aeo: null,
      github: null,
      compliance: null,
    });
    expect(result.data.findings.map((f) => f.id)).toEqual(["a:1", "b:2"]);
    expect(result.data.scan.completed_at).toBe("2026-08-15T09:00:00.000Z");
    expect(result.data.scan.trigger).toBe("manual");
  });
});

describe("sortBySeverityCap", () => {
  it("sorteert op ernst (critical eerst) en kapt op 100 per ernst", () => {
    const items: Finding[] = [];
    for (let i = 0; i < 105; i++) {
      items.push(
        makeFinding({ id: `h:${i}`, title: `Hoog ${i}`, severity: "high" }),
      );
    }
    items.push(makeFinding({ id: "c:1", title: "Kritiek", severity: "critical" }));
    items.push(makeFinding({ id: "i:1", title: "Info", severity: "info" }));

    const { sorted, omitted } = sortBySeverityCap(items);
    expect(sorted[0].id).toBe("c:1");
    expect(sorted[sorted.length - 1].id).toBe("i:1");
    expect(sorted.filter((f) => f.severity === "high")).toHaveLength(100);
    expect(omitted.high).toBe(5);
    expect(omitted.critical).toBe(0);
  });
});

describe("reportFilename", () => {
  it("bouwt scanpal-{host}-{datum}.{ext} (YYYY-MM-DD)", () => {
    expect(
      reportFilename("example.com", "2026-08-15T09:00:00.000Z", "pdf"),
    ).toBe("scanpal-example.com-2026-08-15.pdf");
    expect(
      reportFilename("www.example.com/pad", "2026-08-15T09:00:00.000Z", "md"),
    ).toBe("scanpal-www.example.com-2026-08-15.md");
  });
});