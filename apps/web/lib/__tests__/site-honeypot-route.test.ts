import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sites/[id]/honeypot/route";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { setHoneypot } from "@/lib/threats-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/credits", () => ({
  getPlanForTeam: vi.fn(),
}));
vi.mock("@/lib/threats-core", () => ({
  setHoneypot: vi.fn(),
}));

const queryMock = vi.mocked(pool.query);
const getUserMock = vi.mocked(getSessionUser);
const planMock = vi.mocked(getPlanForTeam);
const setHoneypotMock = vi.mocked(setHoneypot);

const USER = { id: "user-1", email: "a@b.c", user_metadata: {}, app_metadata: {} };
const SITE_ID = "00000000-0000-4000-8000-000000000001";

const HONEYPOT = {
  site_id: SITE_ID,
  site_url: "voorbeeld.nl",
  site_label: null,
  honeypot_id: "00000000-0000-4000-8000-000000000002",
  enabled: true,
  url: "https://scanpal.app/h/abc",
  path: "/h/abc",
  hit_count: 3,
  created_at: "2026-08-16T09:00:00.000Z",
};

function postResponse(body: unknown): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/sites/${SITE_ID}/honeypot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: SITE_ID }) });
}

describe("POST /api/sites/[id]/honeypot", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    planMock.mockReset();
    setHoneypotMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ team_id: "team-1" }],
    } as never);
    planMock.mockResolvedValue({ id: "pro" } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 404 zonder sessie (geen lek van bestaan)", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await postResponse({ enabled: true });
    expect(response.status).toBe(404);
  });

  it("geeft 404 voor een site die geen lid-toegang heeft", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await postResponse({ enabled: true });
    expect(response.status).toBe(404);
  });

  it("geeft 403 + upsell op het Free-plan", async () => {
    planMock.mockResolvedValue({ id: "free" } as never);
    const response = await postResponse({ enabled: true });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      upsell: { plan: "pro" },
      feature: "threats",
    });
  });

  it("geeft 400 bij een ongeldige body", async () => {
    const response = await postResponse({ enabled: "ja" });
    expect(response.status).toBe(400);
  });

  it("zet de honeypot en retourneert view + snippet", async () => {
    setHoneypotMock.mockResolvedValue({
      view: HONEYPOT,
      snippet: {
        html: "<a href=\"https://scanpal.app/h/abc\">.</a>",
        url: "https://scanpal.app/h/abc",
      },
    } as never);
    const response = await postResponse({ enabled: true, rotate_token: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.honeypot.hit_count).toBe(3);
    expect(body.snippet.url).toBe("https://scanpal.app/h/abc");
    expect(setHoneypotMock).toHaveBeenCalledWith(
      expect.anything(),
      "team-1",
      SITE_ID,
      { enabled: true, rotateToken: true },
    );
  });

  it("default rotate_token naar false", async () => {
    setHoneypotMock.mockResolvedValue({
      view: HONEYPOT,
      snippet: { html: "", url: "https://scanpal.app/h/abc" },
    } as never);
    await postResponse({ enabled: false });
    expect(setHoneypotMock).toHaveBeenCalledWith(
      expect.anything(),
      "team-1",
      SITE_ID,
      { enabled: false, rotateToken: false },
    );
  });
});
