import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireSessionOwner,
  requireTeam,
} from "@/lib/api-auth";
import { getSessionUser } from "@/lib/supabase/server";
import { getOrCreateUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { findApiKey, findApiKeyByPrefix, hashApiKey, recordApiKeyUsage } from "@/lib/api-keys-core";
import {
  canonicalQueryString,
  canonicalRequestString,
  deriveHmacSigningSecret,
  sha256Hex,
  signHmacRequest,
} from "@/lib/api-hmac";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPlanForTeam } from "@/lib/credits";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/team", () => ({
  getOrCreateUserTeam: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/api-keys-core", () => ({
  findApiKey: vi.fn(),
  findApiKeyByPrefix: vi.fn(),
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
const teamContextMock = vi.mocked(getOrCreateUserTeam);
const findKeyMock = vi.mocked(findApiKey);
const findPrefixMock = vi.mocked(findApiKeyByPrefix);
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

/** Feature 25 — bouw een HMAC-request met geldige signature. */
function hmacRequest(
  prefix: string,
  keyHash: string,
  overrides: {
    method?: string;
    path?: string;
    query?: string;
    body?: string;
    timestamp?: string;
    signature?: string;
    omitSignature?: boolean;
    omitTimestamp?: boolean;
  } = {},
): Request {
  const method = overrides.method ?? "GET";
  const path = overrides.path ?? "/api/scans";
  const query = canonicalQueryString(overrides.query ?? "");
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const bodyHash =
    method === "GET" || method === "HEAD" || method === "DELETE"
      ? sha256Hex("")
      : sha256Hex(overrides.body ?? "");
  const canonical = canonicalRequestString(method, path, query, timestamp, bodyHash);
  const secret = deriveHmacSigningSecret(keyHash);
  const signature = overrides.signature ?? signHmacRequest(secret, canonical);
  const headers: Record<string, string> = {
    Authorization: `HMAC ${prefix}`,
  };
  if (!overrides.omitTimestamp) headers["X-Timestamp"] = timestamp;
  if (!overrides.omitSignature) headers["X-Signature"] = signature;
  const url = `${path}${overrides.query ?? ""}`;
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    body: overrides.body,
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
    vi.stubEnv("API_HMAC_SIGNING_SECRET", "test-derivation-domain");
    vi.clearAllMocks();
    getUserMock.mockResolvedValue(USER as never);
    teamContextMock.mockResolvedValue({
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
    vi.unstubAllEnvs();
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

  // Feature 25 — HMAC-request-signing.
  it("HMAC met geldige signature → team-id (zelfde pad als bearer)", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    const result = await requireTeam(
      hmacRequest("sp_live_abc", "hashed:sp_live_abc"),
    );

    expect(findPrefixMock).toHaveBeenCalledWith(pool, "sp_live_abc");
    expect(rateLimitMock).toHaveBeenCalledWith("key:key-1", 120);
    expect(rateLimitMock).toHaveBeenCalledWith("team:team-1", 120);
    expect(usageMock).toHaveBeenCalledWith(pool, "key-1");
    expect(result).toMatchObject({
      ok: true,
      ctx: { teamId: "team-1", auth: { type: "key", keyId: "key-1" } },
    });
  });

  it("HMAC met verkeerde signature → 401", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    const result = await requireTeam(
      hmacRequest("sp_live_abc", "wrong-secret"),
    );

    expect(result).toEqual({ ok: false, status: 401 });
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("HMAC zonder X-Signature header → 401", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    const result = await requireTeam(
      hmacRequest("sp_live_abc", "hashed:sp_live_abc", { omitSignature: true }),
    );

    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("HMAC met verlopen timestamp → 401 (replay-bescherming)", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    const result = await requireTeam(
      hmacRequest("sp_live_abc", "hashed:sp_live_abc", {
        timestamp: String(Math.floor(Date.now() / 1000) - 600),
      }),
    );

    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("HMAC met onbekende prefix → 401", async () => {
    findPrefixMock.mockResolvedValue(null as never);

    const result = await requireTeam(
      hmacRequest("sp_live_unknown", "whatever"),
    );

    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("HMAC met gerevokede key → 401", async () => {
    findPrefixMock.mockResolvedValue(
      makeKeyRow({ revoked_at: new Date("2026-08-16T09:00:00Z") }) as never,
    );

    const result = await requireTeam(
      hmacRequest("sp_live_abc", "hashed:sp_live_abc"),
    );

    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("HMAC POST met body → signature over body-hash verifieert", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    const body = JSON.stringify({ url: "https://example.com" });
    const result = await requireTeam(
      hmacRequest("sp_live_abc", "hashed:sp_live_abc", {
        method: "POST",
        body,
      }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("HMAC POST met gewijzigde body → signature wijst af", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    // Signature over oorspronkelijke body, request stuurt andere body.
    const result = await requireTeam(
      hmacRequest("sp_live_abc", "hashed:sp_live_abc", {
        method: "POST",
        body: JSON.stringify({ url: "https://other.com" }),
        signature: signHmacRequest(
          deriveHmacSigningSecret("hashed:sp_live_abc"),
          canonicalRequestString(
            "POST",
            "/api/scans",
            "",
            String(Math.floor(Date.now() / 1000)),
            sha256Hex(JSON.stringify({ url: "https://example.com" })),
          ),
        ),
      }),
    );

    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("HMAC GET-signature is gebonden aan de query-string (geen hergebruik voor ?site_id=…)", async () => {
    findPrefixMock.mockResolvedValue(makeKeyRow() as never);

    const legit = hmacRequest("sp_live_abc", "hashed:sp_live_abc", {
      query: "?page=1",
    });
    const hijacked = hmacRequest("sp_live_abc", "hashed:sp_live_abc", {
      query: "?site_id=team-9&page=1",
      timestamp: legit.headers.get("X-Timestamp") ?? undefined,
      signature: legit.headers.get("X-Signature") ?? undefined,
    });

    const result = await requireTeam(hijacked);
    expect(result).toEqual({ ok: false, status: 401 });
  });
});

describe("requireSessionOwner", () => {
  beforeEach(() => {
    vi.stubEnv("API_HMAC_SIGNING_SECRET", "test-derivation-domain");
    vi.clearAllMocks();
    getUserMock.mockResolvedValue(USER as never);
    teamContextMock.mockResolvedValue({
      team: { id: "team-1", name: "Team 1" },
      membership: { team_id: "team-1", user_id: "user-1", role: "owner", status: "accepted" },
      user: { id: "user-1", email: "a@b.c", onboarding_completed_at: null },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const result = await requireSessionOwner();
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("403 voor een member", async () => {
    teamContextMock.mockResolvedValue({
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
