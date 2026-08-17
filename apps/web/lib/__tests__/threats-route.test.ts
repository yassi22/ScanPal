import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/threats/route";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { ensureUserTeam } from "@/lib/team";
import { getPlanForTeam } from "@/lib/credits";
import { listThreatOverviews } from "@/lib/threats-core";

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
  listThreatOverviews: vi.fn(),
}));

const queryMock = vi.mocked(pool.query);
const getUserMock = vi.mocked(getSessionUser);
const ensureTeamMock = vi.mocked(ensureUserTeam);
const planMock = vi.mocked(getPlanForTeam);
const overviewMock = vi.mocked(listThreatOverviews);

const USER = { id: "user-1", email: "a@b.c", user_metadata: {}, app_metadata: {} };

const OVERVIEW = {
  site: {
    site_id: "00000000-0000-4000-8000-000000000001",
    site_url: "voorbeeld.nl",
    site_label: null,
    honeypot_id: "00000000-0000-4000-8000-000000000002",
    enabled: true,
    url: "https://scanpal.app/h/abc",
    path: "/h/abc",
    hit_count: 3,
    created_at: "2026-08-16T09:00:00.000Z",
  },
  last_event: {
    id: "00000000-0000-4000-8000-000000000003",
    team_id: "00000000-0000-4000-8000-000000000004",
    site_id: "00000000-0000-4000-8000-000000000001",
    honeypot_id: "00000000-0000-4000-8000-000000000002",
    kind: "hit",
    risk: "low",
    path: "/h/abc",
    ip: "203.0.113.10",
    user_agent: null,
    country: null,
    asn: null,
    matched_rule: null,
    payload: {},
    created_at: "2026-08-16T09:00:00.000Z",
  },
  high_risk_count: 0,
  active_patterns: [],
};

describe("GET /api/threats", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    ensureTeamMock.mockReset();
    planMock.mockReset();
    overviewMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
    ensureTeamMock.mockResolvedValue({ team: { id: "team-1" } } as never);
    planMock.mockResolvedValue({ id: "pro" } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("geeft 403 + upsell op het Free-plan", async () => {
    planMock.mockResolvedValue({ id: "free" } as never);
    const response = await GET();
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      error: expect.stringContaining("Pro"),
      upsell: { plan: "pro" },
      feature: "threats",
    });
  });

  it("retourneert het overzicht op Pro", async () => {
    overviewMock.mockResolvedValue([OVERVIEW] as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0].site.hit_count).toBe(3);
  });

  it("geeft 500 als de data niet aan het contract voldoet", async () => {
    overviewMock.mockResolvedValue([
      { ...OVERVIEW, site: { ...OVERVIEW.site, enabled: "ja" } },
    ] as never);
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
