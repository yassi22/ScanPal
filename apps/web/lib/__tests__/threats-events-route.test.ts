import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/threats/events/route";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { ensureUserTeam } from "@/lib/team";
import { getPlanForTeam } from "@/lib/credits";
import { listThreatEvents } from "@/lib/threats-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/team", () => ({
  ensureUserTeam: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/credits", () => ({
  getPlanForTeam: vi.fn(),
}));
vi.mock("@/lib/threats-core", () => ({
  listThreatEvents: vi.fn(),
}));

const queryMock = vi.mocked(pool.query);
const getUserMock = vi.mocked(getSessionUser);
const ensureTeamMock = vi.mocked(ensureUserTeam);
const planMock = vi.mocked(getPlanForTeam);
const eventsMock = vi.mocked(listThreatEvents);

const USER = { id: "user-1", email: "a@b.c", user_metadata: {}, app_metadata: {} };

const EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  team_id: "00000000-0000-4000-8000-000000000002",
  site_id: "00000000-0000-4000-8000-000000000003",
  honeypot_id: "00000000-0000-4000-8000-000000000004",
  kind: "pattern",
  risk: "high",
  path: "/h/x/.env",
  ip: "203.0.113.10",
  user_agent: "sqlmap/1.7",
  country: null,
  asn: null,
  matched_rule: "path_env",
  payload: {},
  created_at: "2026-08-16T09:00:00.000Z",
};

function getResponse(search: string): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/threats/events?${search}`));
}

describe("GET /api/threats/events", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    ensureTeamMock.mockReset();
    planMock.mockReset();
    eventsMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
    ensureTeamMock.mockResolvedValue({ team: { id: "team-1" } } as never);
    planMock.mockResolvedValue({ id: "pro" } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await getResponse("");
    expect(response.status).toBe(401);
  });

  it("geeft 403 + upsell op het Free-plan", async () => {
    planMock.mockResolvedValue({ id: "free" } as never);
    const response = await getResponse("");
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.upsell).toEqual({ plan: "pro" });
  });

  it("geeft 400 bij een ongeldige risk-filter", async () => {
    const response = await getResponse("risk=fatal");
    expect(response.status).toBe(400);
  });

  it("geeft 400 bij een ongeldige page", async () => {
    const response = await getResponse("page=0");
    expect(response.status).toBe(400);
  });

  it("retourneert gefilterde, gepagineerde events", async () => {
    eventsMock.mockResolvedValue({ events: [EVENT], total: 1 } as never);
    const response = await getResponse("risk=high&kind=pattern&page=2&page_size=25");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      events: [EVENT],
      total: 1,
      page: 2,
      page_size: 25,
    });
    expect(eventsMock).toHaveBeenCalledWith(
      expect.anything(),
      "team-1",
      expect.objectContaining({ risk: "high", kind: "pattern", page: 2 }),
    );
  });

  it("gebruikt defaults bij geen filters", async () => {
    eventsMock.mockResolvedValue({ events: [], total: 0 } as never);
    const response = await getResponse("");
    expect(response.status).toBe(200);
    expect(eventsMock).toHaveBeenCalledWith(
      expect.anything(),
      "team-1",
      expect.objectContaining({ page: 1, page_size: 25 }),
    );
  });
});
