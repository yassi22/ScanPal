import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getOwnership } from "@/app/api/sites/[id]/ownership/route";
import { POST as verifyOwnership } from "@/app/api/sites/[id]/verify-ownership/route";
import { POST as rotateOwnership } from "@/app/api/sites/[id]/ownership-token-rotations/route";
import { requireTeam } from "@/lib/api-auth";
import { getSite } from "@/lib/sites-core";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  checkOwnershipLive,
  ensureOwnershipToken,
  recordOwnershipCheck,
  rotateOwnershipToken,
} from "@scanpal/scan-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({ requireTeam: vi.fn() }));
vi.mock("@/lib/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("@/lib/sites-core", () => ({ getSite: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/workspace-scope", () => ({
  workspaceIdForContext: vi.fn(() => undefined),
}));
vi.mock("@scanpal/scan-core", () => ({
  checkOwnershipLive: vi.fn(),
  ensureOwnershipToken: vi.fn(),
  recordOwnershipCheck: vi.fn(),
  rotateOwnershipToken: vi.fn(),
}));

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";
const TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST";
const OWNERSHIP = {
  token: TOKEN,
  record_name: "example.com",
  record_value: `scanpal-verify=${TOKEN}`,
  verified_at: null,
};

const requireTeamMock = vi.mocked(requireTeam);
const getSiteMock = vi.mocked(getSite);
const rateLimitMock = vi.mocked(checkRateLimit);
const checkLiveMock = vi.mocked(checkOwnershipLive);
const ensureTokenMock = vi.mocked(ensureOwnershipToken);
const recordCheckMock = vi.mocked(recordOwnershipCheck);
const rotateTokenMock = vi.mocked(rotateOwnershipToken);

function request(path: string, method = "GET") {
  return new NextRequest(`http://localhost${path}`, { method });
}

const context = { params: Promise.resolve({ id: SITE_ID }) };

describe("ownership API-routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTeamMock.mockResolvedValue({
      ok: true,
      ctx: {
        teamId: TEAM_ID,
        auth: {
          type: "session",
          userId: "user-1",
          role: "owner",
          workspaceId: null,
        },
      },
    });
    getSiteMock.mockResolvedValue({ id: SITE_ID } as never);
    rateLimitMock.mockResolvedValue({ ok: true });
    ensureTokenMock.mockResolvedValue(OWNERSHIP);
    checkLiveMock.mockResolvedValue({ verified: true, token: TOKEN });
    recordCheckMock.mockResolvedValue(new Date("2026-08-25T12:00:00.000Z"));
    rotateTokenMock.mockResolvedValue({
      ...OWNERSHIP,
      token: `N${TOKEN.slice(1)}`,
      record_value: `scanpal-verify=N${TOKEN.slice(1)}`,
    });
  });

  it("maakt het token lazy aan en retourneert DNS-instructies", async () => {
    const response = await getOwnership(
      request(`/api/sites/${SITE_ID}/ownership`),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(OWNERSHIP);
    expect(ensureTokenMock).toHaveBeenCalledWith(expect.anything(), {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      workspaceId: undefined,
    });
  });

  it("lekt een site buiten team/workspace niet", async () => {
    getSiteMock.mockResolvedValue(null);
    const response = await getOwnership(
      request(`/api/sites/${SITE_ID}/ownership`),
      context,
    );
    expect(response.status).toBe(404);
    expect(ensureTokenMock).not.toHaveBeenCalled();
  });

  it("controleert DNS live en slaat het verificatiemoment op", async () => {
    const response = await verifyOwnership(
      request(`/api/sites/${SITE_ID}/verify-ownership`, "POST"),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verified: true,
      verified_at: "2026-08-25T12:00:00.000Z",
    });
    expect(rateLimitMock).toHaveBeenCalledWith(
      `ownership-verify:${SITE_ID}`,
      5,
    );
    expect(checkLiveMock).toHaveBeenCalledWith(SITE_ID, {
      db: expect.anything(),
      teamId: TEAM_ID,
      workspaceId: undefined,
    });
    expect(recordCheckMock).toHaveBeenCalledWith(expect.anything(), {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      token: TOKEN,
      verified: true,
      workspaceId: undefined,
    });
  });

  it("retourneert verified:false wanneer het TXT-record ontbreekt", async () => {
    checkLiveMock.mockResolvedValue({
      verified: false,
      reason: "record-not-found",
      token: TOKEN,
    });
    recordCheckMock.mockResolvedValue(null);
    const response = await verifyOwnership(
      request(`/api/sites/${SITE_ID}/verify-ownership`, "POST"),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verified: false,
      reason: "record-not-found",
    });
  });

  it("meldt token-rotated wanneer het token tijdens verificatie roteerde", async () => {
    // recordOwnershipCheck matcht geen rij meer (token gewijzigd) → undefined.
    recordCheckMock.mockResolvedValue(undefined);
    const response = await verifyOwnership(
      request(`/api/sites/${SITE_ID}/verify-ownership`, "POST"),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verified: false,
      reason: "token-rotated",
    });
  });

  it("rate-limit verificatie per site met Retry-After", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
    const response = await verifyOwnership(
      request(`/api/sites/${SITE_ID}/verify-ownership`, "POST"),
      context,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(checkLiveMock).not.toHaveBeenCalled();
  });

  it("rate-limit het ophalen van instructies met Retry-After", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfterSeconds: 12 });
    const response = await getOwnership(
      request(`/api/sites/${SITE_ID}/ownership`),
      context,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(rateLimitMock).toHaveBeenCalledWith(`ownership-read:${SITE_ID}`, 30);
    expect(ensureTokenMock).not.toHaveBeenCalled();
  });

  it("rate-limit tokenrotatie met Retry-After", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const response = await rotateOwnership(
      request(`/api/sites/${SITE_ID}/ownership-token-rotations`, "POST"),
      context,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(rateLimitMock).toHaveBeenCalledWith(`ownership-rotate:${SITE_ID}`, 5);
    expect(rotateTokenMock).not.toHaveBeenCalled();
  });

  it("roteert het token via een afzonderlijke subresource", async () => {
    const response = await rotateOwnership(
      request(`/api/sites/${SITE_ID}/ownership-token-rotations`, "POST"),
      context,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token).toBe(`N${TOKEN.slice(1)}`);
    expect(body.verified_at).toBeNull();
    expect(rotateTokenMock).toHaveBeenCalledWith(expect.anything(), {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      workspaceId: undefined,
    });
  });
});
