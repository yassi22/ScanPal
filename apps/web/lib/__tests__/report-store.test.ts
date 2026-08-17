import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { getReportContent, listReports, saveReport } from "@/lib/report/store";

vi.mock("server-only", () => ({}));

function fakePool(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: rows.length, rows }),
  } as unknown as Pool;
}

const META_ROW = {
  id: "00000000-0000-4000-8000-00000000000a",
  site_id: "00000000-0000-4000-8000-000000000002",
  scan_id: "00000000-0000-4000-8000-000000000001",
  format: "md",
  filename: "scanpal-example-com-2026-08-15.md",
  size_bytes: 5,
  created_at: new Date("2026-08-15T09:00:00.000Z"),
};

describe("saveReport", () => {
  it("insert en retourneert ReportMeta met ISO-datums", async () => {
    const pool = fakePool([META_ROW]);
    const meta = await saveReport(pool, {
      teamId: "team-1",
      siteId: "site-1",
      scanId: "scan-1",
      format: "md",
      filename: "scanpal-example-com-2026-08-15.md",
      content: Buffer.from("hello"),
    });
    expect(meta.id).toBe(META_ROW.id);
    expect(meta.created_at).toBe("2026-08-15T09:00:00.000Z");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into reports"),
      expect.arrayContaining(["team-1", "site-1", "scan-1", "md"]),
    );
  });
});

describe("listReports", () => {
  it("retourneert team-scoped meta-rijen met next_cursor null op de laatste pagina", async () => {
    const pool = fakePool([META_ROW, { ...META_ROW, format: "pdf" }]);
    const result = await listReports(pool, { teamId: "team-1" });
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0].created_at).toBe("2026-08-15T09:00:00.000Z");
    expect(result.reports[1].format).toBe("pdf");
    expect(result.next_cursor).toBeNull();
  });

  it("voegt een site_id-filter toe als die gegeven is", async () => {
    const pool = fakePool([]);
    await listReports(pool, { teamId: "team-1", siteId: "site-1" });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("and r.site_id = $2"),
      expect.arrayContaining(["team-1", "site-1"]),
    );
  });

  it("zet next_cursor wanneer er meer rijen zijn dan limit", async () => {
    const older = { ...META_ROW, id: "00000000-0000-4000-8000-000000000009" };
    const pool = fakePool([META_ROW, older]);
    const result = await listReports(pool, {
      teamId: "team-1",
      limit: 1,
    });
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].id).toBe(META_ROW.id);
    expect(result.next_cursor).not.toBeNull();
  });

  it("voegt een cursor-filter toe en haalt limit + 1 rijen op", async () => {
    const pool = fakePool([]);
    await listReports(pool, {
      teamId: "team-1",
      cursor: { created_at: "2026-08-15T09:00:00.000Z", id: META_ROW.id },
      limit: 10,
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("(r.created_at, r.id) < ("),
      expect.arrayContaining([
        "team-1",
        "2026-08-15T09:00:00.000Z",
        META_ROW.id,
        11,
      ]),
    );
  });
});

describe("getReportContent", () => {
  it("retourneert bytes + filename + format voor een opgeslagen rij", async () => {
    const content = Buffer.from("%PDF-1.7 test");
    const pool = fakePool([
      { format: "pdf", filename: "scanpal-x.pdf", content },
    ]);
    const row = await getReportContent(pool, { teamId: "team-1", reportId: "r-1" });
    expect(row).toEqual({ format: "pdf", filename: "scanpal-x.pdf", content });
  });

  it("geeft null voor een rij buiten het team", async () => {
    const row = await getReportContent(fakePool([]), { teamId: "team-1", reportId: "r-1" });
    expect(row).toBeNull();
  });
});