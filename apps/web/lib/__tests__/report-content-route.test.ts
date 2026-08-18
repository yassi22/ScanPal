import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reports/[scanId]/content/route";
import { requireTeam } from "@/lib/api-auth";
import { getReportContent } from "@/lib/report/store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ pool: {} }));
vi.mock("@/lib/api-auth", () => ({ requireTeam: vi.fn() }));
vi.mock("@/lib/report/store", () => ({ getReportContent: vi.fn() }));

const requireTeamMock = vi.mocked(requireTeam);
const getReportContentMock = vi.mocked(getReportContent);

const REPORT_ID = "00000000-0000-4000-8000-00000000000a";
const MD_CONTENT = Buffer.from("# markdown body", "utf8");

function request(): NextRequest {
  return new NextRequest(`http://localhost/api/reports/${REPORT_ID}/content`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
  getReportContentMock.mockResolvedValue({
    format: "md",
    filename: "scanpal-example-com-2026-08-15.md",
    content: MD_CONTENT,
  } as never);
});

describe("GET /api/reports/[scanId]/content", () => {
  it("geeft 401 zonder auth", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const res = await GET(request(), { params: Promise.resolve({ scanId: REPORT_ID }) });
    expect(res.status).toBe(401);
  });

  it("geeft 404 voor een rapport buiten het team", async () => {
    getReportContentMock.mockResolvedValue(null);
    const res = await GET(request(), { params: Promise.resolve({ scanId: REPORT_ID }) });
    expect(res.status).toBe(404);
  });

  it("retourneert de opgeslagen bytes + filename zonder regeneratie", async () => {
    const res = await GET(request(), { params: Promise.resolve({ scanId: REPORT_ID }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="scanpal-example-com-2026-08-15.md"',
    );
    expect(await res.text()).toBe("# markdown body");
  });

  it("gebruikt application/pdf voor een opgeslagen PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7 test");
    getReportContentMock.mockResolvedValue({
      format: "pdf",
      filename: "scanpal-x-2026-08-15.pdf",
      content: pdf,
    } as never);
    const res = await GET(request(), { params: Promise.resolve({ scanId: REPORT_ID }) });
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 test");
  });
});