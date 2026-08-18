import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/teams/[teamId]/branding/route";
import { requireOwner } from "@/lib/authz";
import { assertPlanFeature, PlanFeatureError } from "@/lib/credits";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/credits", () => ({
  assertPlanFeature: vi.fn(),
  PlanFeatureError: class extends Error {
    feature = "white_label";
    plan = "pro";
  },
}));
vi.mock("@/lib/db", () => ({ pool: { query: vi.fn() } }));

const requireOwnerMock = vi.mocked(requireOwner);
const assertFeatureMock = vi.mocked(assertPlanFeature);
const { pool } = await import("@/lib/db");
const queryMock = vi.mocked(pool.query);

const TEAM_ID = "00000000-0000-4000-8000-000000000001";

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/teams/${TEAM_ID}/branding`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOwnerMock.mockResolvedValue({ ok: true } as never);
  assertFeatureMock.mockResolvedValue({ id: "max" } as never);
  queryMock.mockResolvedValue({ rowCount: 1, rows: [{ branding: { hide_branding: false } }] } as never);
});

describe("PATCH /api/teams/[teamId]/branding", () => {
  it("slaat gevalideerde branding op voor Max", async () => {
    const response = await PATCH(request({
      logo_url: "https://example.com/logo.png",
      primary_color: "#123456",
      report_name: "Acme",
      hide_branding: true,
    }), { params: Promise.resolve({ teamId: TEAM_ID }) });

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("update teams set branding"),
      expect.arrayContaining([TEAM_ID]),
    );
  });

  it("blokkeert branding buiten het white-label plan", async () => {
    assertFeatureMock.mockRejectedValue(new PlanFeatureError("white_label", "pro"));
    const response = await PATCH(request({ hide_branding: true }), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ upsell: { plan: "max" } });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("weigert een ongeldige accentkleur", async () => {
    const response = await PATCH(request({ primary_color: "red", hide_branding: false }), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });
    expect(response.status).toBe(400);
  });
});
