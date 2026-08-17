import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/sites/[id]/route";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { updateSite, type SiteRowWithStatus } from "@/lib/sites-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/credits", () => ({
  assertPlanFeature: vi.fn(),
  PlanFeatureError: class PlanFeatureError extends Error {},
}));
vi.mock("@/lib/sites-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sites-core")>()),
  updateSite: vi.fn(),
}));

const queryMock = vi.mocked(pool.query);
const requireTeamMock = vi.mocked(requireTeam);
const updateSiteMock = vi.mocked(updateSite);

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";

function makeSiteRow(overrides: Partial<SiteRowWithStatus> = {}): SiteRowWithStatus {
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
    created_at: new Date("2026-08-16T08:00:00Z"),
    ...overrides,
  };
}

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
}

async function patchResponse(body: unknown): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/sites/${SITE_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ id: SITE_ID }) });
}

describe("PATCH /api/sites/[id] — public_status (plan 57)", () => {
  beforeEach(() => {
    queryMock.mockReset();
    requireTeamMock.mockReset();
    updateSiteMock.mockReset();
    sessionTeam();
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ public_status_slug: null }],
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie en zonder key", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await patchResponse({ public_status: { enabled: true } });
    expect(response.status).toBe(401);
  });

  it("geeft 400 bij een ongeldige body", async () => {
    const response = await patchResponse({ public_status: { enabled: "ja" } });
    expect(response.status).toBe(400);
  });

  it("geeft 404 voor een site die het team niet bezit", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await patchResponse({ public_status: { enabled: true } });
    expect(response.status).toBe(404);
  });

  it("schakelt de publieke statuspagina in en retourneert de slug", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ public_status_slug: null }],
    } as never);
    updateSiteMock.mockResolvedValue(
      makeSiteRow({ public_status_slug: "abc123def4567890" }),
    );

    const response = await patchResponse({ public_status: { enabled: true } });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.site.public_status_slug).toBe("abc123def4567890");
    expect(updateSiteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        teamId: "team-1",
        siteId: SITE_ID,
        publicStatus: { enabled: true },
        currentSlug: null,
      }),
    );
  });

  it("schakelt de publieke statuspagina uit (slug wordt null)", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ public_status_slug: "abc123def4567890" }],
    } as never);
    updateSiteMock.mockResolvedValue(makeSiteRow({ public_status_slug: null }));

    const response = await patchResponse({ public_status: { enabled: false } });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.site.public_status_slug).toBeNull();
    expect(updateSiteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        publicStatus: { enabled: false },
        currentSlug: "abc123def4567890",
      }),
    );
  });

  it("laat label/github_repo-wijziging zonder public_status ongemoeid", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ public_status_slug: null }],
    } as never);
    updateSiteMock.mockResolvedValue(makeSiteRow({ label: "Nieuw" }));

    const response = await patchResponse({ label: "Nieuw" });
    expect(response.status).toBe(200);
    expect(updateSiteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        publicStatus: undefined,
      }),
    );
  });
});