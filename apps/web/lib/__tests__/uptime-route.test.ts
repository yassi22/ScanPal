import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/uptime/route";
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

const TEAM_ID = "team-1";

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: TEAM_ID, auth: { type: "session", userId: "user-1" } },
  } as never);
}

async function getResponse(): Promise<Response> {
  return GET(new Request("http://localhost/api/uptime"));
}

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    site_id: "00000000-0000-4000-8000-000000000001",
    url: "voorbeeld.nl",
    label: null,
    uptime_state: "up",
    uptime_state_changed_at: new Date("2026-08-16T08:00:00Z"),
    uptime_enabled: true,
    up24: 1438,
    total24: 1440,
    avg_latency_24: 110.5,
    p95_latency_24: 220,
    up30: 43190,
    total30: 43200,
    ...overrides,
  };
}

describe("GET /api/uptime", () => {
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
    const response = await getResponse();
    expect(response.status).toBe(401);
  });

  it("geeft 429 + Retry-After boven de rate-limit", async () => {
    requireTeamMock.mockResolvedValue({
      ok: false,
      status: 429,
      retryAfter: 42,
    } as never);
    const response = await getResponse();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("accepteert een API-key (Bearer) en scopet op de team-id van de key", async () => {
    requireTeamMock.mockResolvedValue({
      ok: true,
      ctx: { teamId: "team-2", auth: { type: "key", keyId: "key-1" } },
    } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeSummaryRow()],
    } as never);
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    expect((await response.json()).sites).toHaveLength(1);
  });

  it("retourneert per site summary's met uptime%-berekening", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeSummaryRow()],
    } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({
      site_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      uptime_state: "up",
      uptime_enabled: true,
      uptime_24h_pct: 99.86,
      uptime_30d_pct: 99.98,
      avg_latency_ms_24h: 110.5,
      p95_latency_ms_24h: 220,
      sparkline: [],
    });
  });

  it("geeft null-percentages bij geen events", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeSummaryRow({ up24: 0, total24: 0, up30: 0, total30: 0 })],
    } as never);
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    const response = await getResponse();
    const body = await response.json();
    expect(body.sites[0].uptime_24h_pct).toBeNull();
    expect(body.sites[0].uptime_30d_pct).toBeNull();
  });

  it("geeft 500 als de data niet aan het contract voldoet", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeSummaryRow({ uptime_state: "kapot" })],
    } as never);
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    const response = await getResponse();
    expect(response.status).toBe(500);
  });
});
