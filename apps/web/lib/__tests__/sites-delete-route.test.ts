import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/sites/[id]/route";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { deleteSite } from "@/lib/sites-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/sites-core", () => ({
  deleteSite: vi.fn(),
  updateSite: vi.fn(),
  toSiteJson: vi.fn(),
  SiteError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/credits", () => ({
  assertPlanFeature: vi.fn(),
  PlanFeatureError: class extends Error {
    feature: string;
    plan: string;
    constructor(feature: string, plan: string) {
      super("Functie niet beschikbaar");
      this.feature = feature;
      this.plan = plan;
    }
  },
}));

const ownerMock = vi.mocked(requireSessionOwner);
const queryMock = vi.mocked(pool.query);
const deleteMock = vi.mocked(deleteSite);

const SITE_ID = "00000000-0000-4000-8000-0000000000s1";

function ownerCtx() {
  ownerMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", userId: "user-1" },
  } as never);
}

function deleteRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/sites/${SITE_ID}`, {
    method: "DELETE",
  });
}

describe("DELETE /api/sites/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerCtx();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [] } as never);
    deleteMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 zonder sessie", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: SITE_ID }),
    });
    expect(response.status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("403 voor een member", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: SITE_ID }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Alleen de team-owner kan sites verwijderen");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("204 voor de owner en verwijdert de site", async () => {
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: SITE_ID }),
    });
    expect(response.status).toBe(204);
    expect(queryMock).toHaveBeenCalledWith(
      "select 1 from sites where id = $1 and team_id = $2",
      [SITE_ID, "team-1"],
    );
    expect(deleteMock).toHaveBeenCalledWith(pool, {
      teamId: "team-1",
      siteId: SITE_ID,
    });
  });

  it("404 voor een site van een ander team (authorize-site faalt)", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: SITE_ID }),
    });
    expect(response.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("404 als deleteSite niets vond", async () => {
    deleteMock.mockResolvedValue(false);
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: SITE_ID }),
    });
    expect(response.status).toBe(404);
  });
});