import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { getPublicReport } from "@/lib/public-report-core";
import { buildReportData } from "@/lib/report/data";
import { makeFinding, makeReportData } from "./report-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/report/data", () => ({ buildReportData: vi.fn() }));

const buildReportDataMock = vi.mocked(buildReportData);

function fakePool(rows: unknown[]): Pool {
  return { query: vi.fn().mockResolvedValueOnce({ rowCount: rows.length, rows }).mockResolvedValueOnce({ rowCount: 1, rows: [{ team_id: "team-1" }] }) } as unknown as Pool;
}

describe("getPublicReport", () => {
  it("wijst tokens met het verkeerde formaat af zonder DB-query", async () => {
    const db = { query: vi.fn() } as unknown as Pool;
    expect(await getPublicReport(db, "te-kort")).toBeNull();
    expect(vi.mocked(db.query)).not.toHaveBeenCalled();
  });

  it("maskeert evidence en notes in het publieke rapport", async () => {
    buildReportDataMock.mockResolvedValue({
      ok: true,
      data: makeReportData({ findings: [makeFinding({ evidence: "secret", note: "internal" })] }),
      siteId: "site-1",
      omitted: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      githubRepo: null,
      branding: { hide_branding: false },
    });
    const report = await getPublicReport(fakePool([{ id: "scan-1", report_token_expires_at: null }]), "0123456789abcdef0123456789abcdef");
    expect(report?.data.findings[0].evidence).toBeNull();
    expect(report?.data.findings[0].note).toBeNull();
  });
});
