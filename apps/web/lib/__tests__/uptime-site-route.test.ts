import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/uptime/sites/[id]/route";
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

const SITE_ID = "00000000-0000-4000-8000-000000000001";

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    site_id: SITE_ID,
    team_id: "team-1",
    url: "voorbeeld.nl",
    label: null,
    uptime_state: "up",
    uptime_state_changed_at: new Date("2026-08-16T08:00:00Z"),
    uptime_enabled: true,
    up24: 1440,
    total24: 1440,
    avg_latency_24: 110.5,
    p95_latency_24: 200,
    up30: 43200,
    total30: 43200,
    ...overrides,
  };
}

async function getResponse(url: string): Promise<Response> {
  const request = new NextRequest(url);
  return GET(request, { params: Promise.resolve({ id: SITE_ID }) });
}

async function patchResponse(body: unknown): Promise<Response> {
  const request = new NextRequest(
    `http://localhost/api/uptime/sites/${SITE_ID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return PATCH(request, { params: Promise.resolve({ id: SITE_ID }) });
}

describe("GET /api/uptime/sites/[id]", () => {
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
    const response = await getResponse(
      `http://localhost/api/uptime/sites/${SITE_ID}`,
    );
    expect(response.status).toBe(401);
  });

  it("geeft 400 bij een ongeldig days-venster", async () => {
    const response = await getResponse(
      `http://localhost/api/uptime/sites/${SITE_ID}?days=45`,
    );
    expect(response.status).toBe(400);
  });

  it("geeft 404 voor een site die het team niet bezit", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    const response = await getResponse(
      `http://localhost/api/uptime/sites/${SITE_ID}?days=30`,
    );
    expect(response.status).toBe(404);
  });

  it("retourneert summary + serie (30d-uurbuckets) + events + incident", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeSiteRow()],
    } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        {
          bucket: new Date("2026-08-16T08:00:00Z"),
          ups: 60,
          total: 60,
          avg_latency: 100,
        },
        {
          bucket: new Date("2026-08-16T09:00:00Z"),
          ups: 59,
          total: 60,
          avg_latency: 120,
        },
      ],
    } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000099",
          site_id: SITE_ID,
          checked_at: new Date("2026-08-16T09:00:00Z"),
          status: "up",
          latency_ms: 100,
          status_code: 200,
          error: null,
        },
      ],
    } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          started_at: new Date("2026-08-15T10:00:00Z"),
          ended_at: new Date("2026-08-15T10:02:00Z"),
        },
      ],
    } as never);

    const response = await getResponse(
      `http://localhost/api/uptime/sites/${SITE_ID}?days=30`,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.summary.uptime_24h_pct).toBe(100);
    expect(body.series).toHaveLength(2);
    expect(body.series[0].up_pct).toBe(100);
    expect(body.series[1].up_pct).toBeCloseTo(98.33);
    expect(body.series[1].avg_latency_ms).toBe(120);
    expect(body.recent_events).toHaveLength(1);
    expect(body.recent_events[0].status).toBe("up");
    expect(body.last_incident).toEqual({
      started_at: "2026-08-15T10:00:00.000Z",
      ended_at: "2026-08-15T10:02:00.000Z",
    });
  });
});

describe("PATCH /api/uptime/sites/[id]", () => {
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
    const response = await patchResponse({ enabled: false });
    expect(response.status).toBe(401);
  });

  it("geeft 400 bij een ongeldige body", async () => {
    const response = await patchResponse({ enabled: "ja" });
    expect(response.status).toBe(400);
  });

  it("geeft 404 voor een site die het team niet bezit", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await patchResponse({ enabled: false });
    expect(response.status).toBe(404);
  });

  it("zet de monitoring-toggle en retourneert { enabled }", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [] } as never);
    const response = await patchResponse({ enabled: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });

    const updateCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("uptime_enabled"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual([SITE_ID, "team-1", false]);
  });
});
