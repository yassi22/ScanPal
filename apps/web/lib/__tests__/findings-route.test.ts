import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/scans/[id]/findings/route";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

const queryMock = vi.mocked(pool.query);
const requireTeamMock = vi.mocked(requireTeam);

const SCAN_ID = "00000000-0000-4000-8000-000000000001";

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "https:https-ontbreekt",
    check_id: "https",
    category: "http",
    severity: "high",
    title: "HTTPS ontbreekt",
    description: "Site is niet bereikbaar over HTTPS",
    remediation: "Regel een TLS-certificaat",
    evidence: null,
    status: "open",
    note: null,
    created_at: "2026-08-15T09:00:00.000Z",
    ...overrides,
  };
}

function makePayload(items: unknown[] = [makeItem()]) {
  return { v: 1, items };
}

async function getResponse(url: string): Promise<Response> {
  const request = new NextRequest(url);
  return GET(request, { params: Promise.resolve({ id: SCAN_ID }) });
}

describe("GET /api/scans/[id]/findings", () => {
  beforeEach(() => {
    queryMock.mockReset();
    requireTeamMock.mockReset();
    sessionTeam();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie en zonder key", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await getResponse(`http://localhost/api/scans/${SCAN_ID}/findings`);
    expect(response.status).toBe(401);
  });

  it("geeft 404 voor een scan die geen teamlid bezit", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await getResponse(`http://localhost/api/scans/${SCAN_ID}/findings`);
    expect(response.status).toBe(404);
  });

  it("geeft 400 bij ongeldige query-parameters", async () => {
    const response = await getResponse(
      `http://localhost/api/scans/${SCAN_ID}/findings?severity=mega`,
    );
    expect(response.status).toBe(400);
  });

  it("retourneert { findings, total, counts, categories } met filters", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          findings: makePayload([
            makeItem({ severity: "critical", status: "open" }),
            makeItem({ id: "a:anders", severity: "high", status: "fixed" }),
            makeItem({
              id: "b:anders",
              severity: "high",
              category: "seo",
              status: "open",
            }),
          ]),
        },
      ],
    } as never);

    const response = await getResponse(
      `http://localhost/api/scans/${SCAN_ID}/findings?status=open&category=http&limit=1&offset=0`,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].id).toBe("https:https-ontbreekt");
    expect(body.total).toBe(1);
    expect(body.counts).toEqual({
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(body.categories).toEqual(["http", "seo"]);
  });

  it("geeft een lege lijst voor legacy-data zonder v1-payload", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ findings: { checks: [] } }],
    } as never);

    const response = await getResponse(`http://localhost/api/scans/${SCAN_ID}/findings`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.findings).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.counts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });
});
