import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireSessionOwner,
  requireTeam,
} from "@/lib/api-auth";
import { getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { findApiKey, hashApiKey, recordApiKeyUsage } from "@/lib/api-keys-core";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPlanForTeam } from "@/lib/credits";

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
vi.mock("@/lib/api-keys-core", () => ({
  findApiKey: vi.fn(),
  hashApiKey: vi.fn((key: string) => `hashed:${key}`),
  recordApiKeyUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/credits", () => ({
  getPlanForTeam: vi.fn().mockResolvedValue({ apiRatePerMinute: 120 }),
}));

const getUserMock = vi.mocked(getSessionUser);
const ensureTeamMock = vi.mocked(ensureUserTeam);
const findKeyMock = vi.mocked(findApiKey);
const hashKeyMock = vi.mocked(hashApiKey);
const usageMock = vi.mocked(recordApiKeyUsage);
const rateLimitMock = vi.mocked(checkRateLimit);
const planMock = vi.mocked(getPlanForTeam);

const USER = { id: "user-1", email: "a@b.c", user_metadata: {}, app_metadata: {} };

function bearerRequest(key: string): Request {
  return new Request("http://localhost/api/scans", {
    headers: { Authorization: `Bearer ${key}` },
  });
}

function makeKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    team_id: "team-1",
    created_by: "user-1",
    name: "CI",
    prefix: "sp_live_abc",
    key_hash: "hashed:sp_live_abc",
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    created_at: new Date("2026-08-16T08:00:00Z"),
    ...overrides,
  };
}

describe("requireTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue(USER as never);
    ensureTeamMock.mockResolvedValue({
      team: { id: "team-1", name: "Team 1" },
      membership: { team_id: "team-1", user_id: "user-1", role: "owner", status: "accepted" },
      user: { id: "user-1", email: "a@b.c", onboarding_completed_at: null },
    } as never);
    planMock.mockResolvedValue({ apiRatePerMinute: 120 } as never);
    rateLimitMock.mockResolvedValue({ ok: true });
    usageMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 zonder sessie en zonder key", async () => {
    getUserMock.mockResolvedValue(null as never);
    const result = await requireTeam(new Request("http://localhost/api/scans"));
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("sessie → team-id van de gebruiker", async () => {
    const result = await requireTeam(new Request("http://localhost/api/scans"));
    expect(result).toMatchObject({
      ok: true,
      ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
    });
    expect(findKeyMock).not.toHaveBeenCalled();
  });

  it("key → team-id van de key, met rate limiting (key + team) en usage-tracking", async () => {
    findKeyMock.mockResolvedValue(makeKeyRow() as never);

    const result = await requireTeam(bearerRequest("sp_live_abc"));

    expect(hashKeyMock).toHaveBeenCalledWith("sp_live_abc");
    expect(findKeyMock).toHaveBeenCalledWith(pool, "hashed:sp_live_abc");
    expect(rateLimitMock).toHaveBeenCalledWith("key:key-1", 120);
    expect(rateLimitMock).toHaveBeenCalledWith("team:team-1", 120);
    expect(planMock).toHaveBeenCalledWith(pool, "team-1");
    expect(usageMock).toHaveBeenCalledWith(pool, "key-1");
    expect(result).toMatchObject({
      ok: true,
      ctx: { teamId: "team-1", auth: { type: "key", keyId: "key-1" } },
    });
  });

  it("onbekende key → 401", async () => {
    findKeyMock.mockResolvedValue(null as never);
    const result = await requireTeam(bearerRequest("sp_live_geheim"));
    expect(result).toEqual({ ok: false, status: 401 });
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("gerevokede key → 401", async () => {
    findKeyMock.mockResolvedValue(
      makeKeyRow({ revoked_at: new Date("2026-08-16T09:00:00Z") }) as never,
    );
    const result = await requireTeam(bearerRequest("sp_live_abc"));
    expect(result).toEqual({ ok: false, status: 401 });
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("verlopen key → 401", async () => {
    findKeyMock.mockResolvedValue(
      makeKeyRow({ expires_at: new Date("2026-08-15T09:00:00Z") }) as never,
    );
    const result = await requireTeam(bearerRequest("sp_live_abc"));
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("boven de key-limiet → 429 met Retry-After", async () => {
    findKeyMock.mockResolvedValue(makeKeyRow() as never);
    rateLimitMock.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 25 });

    const result = await requireTeam(bearerRequest("sp_live_abc"));

    expect(result).toEqual({ ok: false, status: 429, retryAfter: 25 });
    expect(usageMock).not.toHaveBeenCalled();
  });

  it("boven de team-limiet → 429", async () => {
    findKeyMock.mockResolvedValue(makeKeyRow() as never);
    rateLimitMock.mockResolvedValueOnce({ ok: true });
    rateLimitMock.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 10 });

    const result = await requireTeam(bearerRequest("sp_live_abc"));

    expect(result).toEqual({ ok: false, status: 429, retryAfter: 10 });
  });
});

describe("requireSessionOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue(USER as never);
    ensureTeamMock.mockResolvedValue({
      team: { id: "team-1", name: "Team 1" },
      membership: { team_id: "team-1", user_id: "user-1", role: "owner", status: "accepted" },
      user: { id: "user-1", email: "a@b.c", onboarding_completed_at: null },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const result = await requireSessionOwner();
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("403 voor een member", async () => {
    ensureTeamMock.mockResolvedValue({
      team: { id: "team-1", name: "Team 1" },
      membership: { team_id: "team-1", user_id: "user-2", role: "member", status: "accepted" },
      user: { id: "user-2", email: "b@c.d", onboarding_completed_at: null },
    } as never);
    const result = await requireSessionOwner();
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("owner → team-id + user-id", async () => {
    const result = await requireSessionOwner();
    expect(result).toMatchObject({
      ok: true,
      ctx: { teamId: "team-1", userId: "user-1" },
    });
  });
});
