import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/sites/[id]/route";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getSite, toSiteJson } from "@/lib/sites-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/sites-core", () => ({
  getSite: vi.fn(),
  updateSite: vi.fn(),
  deleteSite: vi.fn(),
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

const requireTeamMock = vi.mocked(requireTeam);
const getSiteMock = vi.mocked(getSite);
const toSiteJsonMock = vi.mocked(toSiteJson);

const SITE_ID = "00000000-0000-4000-8000-0000000000a1";
const TEAM_ID = "00000000-0000-4000-8000-0000000000b2";

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: TEAM_ID, auth: { type: "session", userId: "user-1" } },
  } as never);
}

function siteRow() {
  return {
    id: SITE_ID,
    team_id: TEAM_ID,
    url: "voorbeeld.nl",
    github_repo: null,
    label: null,
    public_status_slug: null,
    github_webhook_configured: false,
    last_scan_id: null,
    last_scan_status: null,
    last_scan_score: null,
    last_scanned_at: null,
    uptime_state: "unknown",
    scan_frequency: "none",
    next_scan_at: null,
    created_at: new Date("2026-08-15T09:00:00Z"),
  };
}

async function getResponse(): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/sites/${SITE_ID}`);
  return GET(request, { params: Promise.resolve({ id: SITE_ID }) });
}

describe("GET /api/sites/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionTeam();
    toSiteJsonMock.mockImplementation((site) => ({
      ...site,
      created_at: site.created_at.toISOString(),
      last_scanned_at: null,
      next_scan_at: null,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie en zonder key", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await getResponse();
    expect(response.status).toBe(401);
    expect(getSiteMock).not.toHaveBeenCalled();
  });

  it("geeft 404 voor een site van een ander team", async () => {
    getSiteMock.mockResolvedValue(null);
    const response = await getResponse();
    expect(response.status).toBe(404);
    expect(getSiteMock).toHaveBeenCalledWith(pool, {
      teamId: TEAM_ID,
      siteId: SITE_ID,
    });
  });

  it("retourneert de site met status (siteWithStatusSchema)", async () => {
    getSiteMock.mockResolvedValue(siteRow() as never);
    const response = await getResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.site).toMatchObject({
      id: SITE_ID,
      url: "voorbeeld.nl",
      uptime_state: "unknown",
    });
  });
});
