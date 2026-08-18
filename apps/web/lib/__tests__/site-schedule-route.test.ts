import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/sites/[id]/schedule/route";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { setSiteSchedule } from "@/lib/scans-core";

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
vi.mock("@/lib/scans-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scans-core")>(
    "@/lib/scans-core",
  );
  return {
    ...actual,
    setSiteSchedule: vi.fn(),
  };
});

const queryMock = vi.mocked(pool.query);
const getUserMock = vi.mocked(getSessionUser);
const planMock = vi.mocked(getPlanForTeam);
const setSiteScheduleMock = vi.mocked(setSiteSchedule);

const USER = { id: "user-1", email: "a@b.c", user_metadata: {}, app_metadata: {} };
const SITE_ID = "00000000-0000-4000-8000-000000000001";

function patchResponse(body: unknown): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/sites/${SITE_ID}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ id: SITE_ID }) });
}

describe("PATCH /api/sites/[id]/schedule", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    planMock.mockReset();
    setSiteScheduleMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ team_id: "team-1" }],
    } as never);
    planMock.mockResolvedValue({ id: "pro" } as never);
    setSiteScheduleMock.mockResolvedValue({
      siteId: SITE_ID,
      scan_frequency: "daily",
      next_scan_at: new Date("2026-08-19T09:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 404 zonder sessie (geen lek van bestaan)", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await patchResponse({ frequency: "daily" });
    expect(response.status).toBe(404);
  });

  it("geeft 404 voor een site die geen lid-toegang heeft", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await patchResponse({ frequency: "daily" });
    expect(response.status).toBe(404);
  });

  it("geeft 400 bij een ongeldige body", async () => {
    const response = await patchResponse({ frequency: "yearly" });
    expect(response.status).toBe(400);
  });

  it("staat frequency 'none' toe op het Free-plan (geen planLookup nodig)", async () => {
    planMock.mockResolvedValue({ id: "free" } as never);
    setSiteScheduleMock.mockResolvedValue({
      siteId: SITE_ID,
      scan_frequency: "none",
      next_scan_at: null,
    });
    const response = await patchResponse({ frequency: "none" });
    expect(response.status).toBe(200);
    expect(planMock).not.toHaveBeenCalled();
  });

  it("geeft 403 + upsell op het Free-plan bij een actieve frequency", async () => {
    planMock.mockResolvedValue({ id: "free" } as never);
    const response = await patchResponse({ frequency: "daily" });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      upsell: { plan: "pro" },
      feature: "schedule",
    });
    expect(setSiteScheduleMock).not.toHaveBeenCalled();
  });

  it("staat Pro toe door de gate en zet het schema", async () => {
    planMock.mockResolvedValue({ id: "pro" } as never);
    const response = await patchResponse({ frequency: "weekly" });
    expect(response.status).toBe(200);
    expect(setSiteScheduleMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      siteId: SITE_ID,
      frequency: "weekly",
    });
  });

  it("staat het Max-plan toe door de gate (voorheen 403 op plan-identiteit)", async () => {
    planMock.mockResolvedValue({ id: "max" } as never);
    const response = await patchResponse({ frequency: "daily" });
    expect(response.status).toBe(200);
    expect(setSiteScheduleMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      siteId: SITE_ID,
      frequency: "daily",
    });
  });

  it("geeft 500 als setSiteSchedule een onverwachte fout gooit", async () => {
    setSiteScheduleMock.mockRejectedValue(new Error("db weg"));
    const response = await patchResponse({ frequency: "daily" });
    expect(response.status).toBe(500);
  });
});
