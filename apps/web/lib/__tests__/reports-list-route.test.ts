import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reports/route";
import { requireTeam } from "@/lib/api-auth";
import { listReports } from "@/lib/report/store";
import { pool } from "@/lib/db";
import { encodeReportCursor } from "@scanpal/shared";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("@/lib/api-auth", () => ({ requireTeam: vi.fn() }));
vi.mock("@/lib/report/store", () => ({ listReports: vi.fn() }));

const requireTeamMock = vi.mocked(requireTeam);
const listReportsMock = vi.mocked(listReports);
const poolQueryMock = vi.mocked(pool.query);

const SITE_ID = "00000000-0000-4000-8000-000000000002";
const REPORT_ID = "00000000-0000-4000-8000-00000000000a";
const NOW = "2026-08-15T09:00:00.000Z";

function request(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/reports${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
  listReportsMock.mockResolvedValue({ reports: [], next_cursor: null } as never);
});

describe("GET /api/reports (historie)", () => {
  it("geeft 401 zonder auth", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("geeft 400 bij een ongeldige site_id", async () => {
    const res = await GET(request("?site_id=geen-uuid"));
    expect(res.status).toBe(400);
  });

  it("geeft 400 bij een ongeldige cursor", async () => {
    const res = await GET(request("?cursor=!!!geen-base64!!!"));
    expect(res.status).toBe(400);
    expect(listReportsMock).not.toHaveBeenCalled();
  });

  it("geeft 404 voor een site_id buiten het team", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const res = await GET(request(`?site_id=${SITE_ID}`));
    expect(res.status).toBe(404);
  });

  it("geeft 200 met de team-scoped lijst en geeft next_cursor door", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1, rows: [{}] } as never);
    const nextCursor = encodeReportCursor(NOW, REPORT_ID);
    listReportsMock.mockResolvedValue({
      reports: [
        {
          id: REPORT_ID,
          site_id: SITE_ID,
          scan_id: "00000000-0000-4000-8000-000000000001",
          format: "pdf",
          filename: "scanpal-x-2026-08-15.pdf",
          size_bytes: 42,
          created_at: NOW,
        },
      ],
      next_cursor: nextCursor,
    } as never);

    const res = await GET(request(`?site_id=${SITE_ID}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reports).toHaveLength(1);
    expect(data.next_cursor).toBe(nextCursor);
    expect(listReportsMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      siteId: SITE_ID,
      cursor: null,
      limit: undefined,
    });
  });

  it("decodeert de cursor en geeft limit door aan listReports", async () => {
    const cursor = encodeReportCursor(NOW, REPORT_ID);
    const res = await GET(request(`?cursor=${cursor}&limit=50`));
    expect(res.status).toBe(200);
    expect(listReportsMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      siteId: undefined,
      cursor: { created_at: NOW, id: REPORT_ID },
      limit: 50,
    });
  });

  it("geeft 200 met lege lijst zonder filter", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reports).toEqual([]);
    expect(data.next_cursor).toBeNull();
    expect(listReportsMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      siteId: undefined,
      cursor: null,
      limit: undefined,
    });
  });
});