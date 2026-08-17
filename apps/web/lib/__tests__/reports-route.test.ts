import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reports/[scanId]/route";
import { requireTeam } from "@/lib/api-auth";
import { buildReportData, reportFilename } from "@/lib/report/data";
import { renderMarkdown } from "@/lib/report/markdown";
import { renderPdf } from "@/lib/report/pdf";
import { saveReport } from "@/lib/report/store";
import { makeReportData, EMPTY_OMITTED } from "./report-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ pool: {} }));
vi.mock("@/lib/api-auth", () => ({ requireTeam: vi.fn() }));
vi.mock("@/lib/report/data", () => ({
  buildReportData: vi.fn(),
  reportFilename: vi.fn(),
}));
vi.mock("@/lib/report/markdown", () => ({ renderMarkdown: vi.fn() }));
vi.mock("@/lib/report/pdf", () => ({ renderPdf: vi.fn() }));
vi.mock("@/lib/report/store", () => ({ saveReport: vi.fn() }));

const requireTeamMock = vi.mocked(requireTeam);
const buildReportDataMock = vi.mocked(buildReportData);
const reportFilenameMock = vi.mocked(reportFilename);
const renderMarkdownMock = vi.mocked(renderMarkdown);
const renderPdfMock = vi.mocked(renderPdf);
const saveReportMock = vi.mocked(saveReport);

const SCAN_ID = "00000000-0000-4000-8000-000000000001";
const SITE_ID = "00000000-0000-4000-8000-000000000002";
const REPORT_ID = "00000000-0000-4000-8000-00000000000a";
const FILENAME = "scanpal-example-com-2026-08-15.md";

function request(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/reports/${SCAN_ID}${query}`);
}

function okResult() {
  return {
    ok: true as const,
    data: makeReportData(),
    siteId: SITE_ID,
    omitted: EMPTY_OMITTED,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
  buildReportDataMock.mockResolvedValue(okResult() as never);
  reportFilenameMock.mockReturnValue(FILENAME);
  renderMarkdownMock.mockReturnValue("# markdown body");
  renderPdfMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
  saveReportMock.mockResolvedValue({
    id: REPORT_ID,
    site_id: SITE_ID,
    scan_id: SCAN_ID,
    format: "md",
    filename: FILENAME,
    size_bytes: 10,
    created_at: "2026-08-15T09:00:00.000Z",
  } as never);
});

describe("GET /api/reports/[scanId]", () => {
  it("geeft 401 zonder sessie of geldige API-key", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const res = await GET(request(), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(401);
  });

  it("geeft 400 bij een ongeldige format", async () => {
    const res = await GET(request("?format=docx"), {
      params: Promise.resolve({ scanId: SCAN_ID }),
    });
    expect(res.status).toBe(400);
    expect(buildReportDataMock).not.toHaveBeenCalled();
  });

  it("geeft 404 voor een scan buiten het team", async () => {
    buildReportDataMock.mockResolvedValue({ ok: false, reason: "not_found" } as never);
    const res = await GET(request("?format=md"), {
      params: Promise.resolve({ scanId: SCAN_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("geeft 409 met status voor een non-completed scan", async () => {
    buildReportDataMock.mockResolvedValue({
      ok: false,
      reason: "not_completed",
      status: "running",
    } as never);
    const res = await GET(request("?format=md"), {
      params: Promise.resolve({ scanId: SCAN_ID }),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data).toMatchObject({ status: "running" });
  });

  it("downloadt Markdown met attachment-headers en slaat de rij op", async () => {
    const res = await GET(request("?format=md"), {
      params: Promise.resolve({ scanId: SCAN_ID }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${FILENAME}"`,
    );
    expect(res.headers.get("x-report-id")).toBe(REPORT_ID);
    expect(await res.text()).toBe("# markdown body");
    expect(saveReportMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: "md", filename: FILENAME }),
    );
  });

  it("downloadt PDF met application/pdf en dezelfde filename", async () => {
    const res = await GET(request("?format=pdf"), {
      params: Promise.resolve({ scanId: SCAN_ID }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${FILENAME}"`,
    );
    expect(renderPdfMock).toHaveBeenCalled();
    expect(saveReportMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: "pdf" }),
    );
  });

  it("geeft 500 en slaat geen rij op als PDF-rendering faalt", async () => {
    renderPdfMock.mockRejectedValueOnce(new Error("render boom"));
    const res = await GET(request("?format=pdf"), {
      params: Promise.resolve({ scanId: SCAN_ID }),
    });
    expect(res.status).toBe(500);
    expect(saveReportMock).not.toHaveBeenCalled();
  });
});