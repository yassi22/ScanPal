import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/api-keys/[id]/route";
import { GET, POST } from "@/app/api/api-keys/route";
import { requireSessionOwner } from "@/lib/api-auth";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/api-auth", () => ({
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/api-keys-core", () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
}));

const ownerMock = vi.mocked(requireSessionOwner);
const createMock = vi.mocked(createApiKey);
const listMock = vi.mocked(listApiKeys);
const revokeMock = vi.mocked(revokeApiKey);

function ownerCtx() {
  ownerMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", userId: "user-1" },
  } as never);
}

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "CI",
    prefix: "sp_live_abc",
    last_used_at: null,
    revoked_at: null,
    created_at: "2026-08-16T08:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerCtx();
    listMock.mockResolvedValue([makeView()] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 zonder sessie", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("403 voor een member", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("retourneert de keys van het team (zonder hashes)", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "CI",
      prefix: "sp_live_abc",
    });
    expect(body.keys[0]).not.toHaveProperty("key_hash");
  });
});

describe("POST /api/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerCtx();
    createMock.mockResolvedValue({
      view: makeView(),
      fullKey: "sp_live_abcd1234...",
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("403 voor een member", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await POST(
      new Request("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "CI" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("400 bij een ongeldige body", async () => {
    const response = await POST(
      new Request("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("maakt een key aan en retourneert de full key 1×", async () => {
    const response = await POST(
      new Request("http://localhost/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CI" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      createdBy: "user-1",
      name: "CI",
    });
    const body = await response.json();
    expect(body.full_key).toBe("sp_live_abcd1234...");
    expect(body.key.name).toBe("CI");
  });
});

describe("DELETE /api/api-keys/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerCtx();
    revokeMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("403 voor een member", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await DELETE(
      new NextRequest(
        "http://localhost/api/api-keys/00000000-0000-4000-8000-000000000001",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
      },
    );
    expect(response.status).toBe(403);
  });

  it("revoke een key van het team (204)", async () => {
    const response = await DELETE(
      new NextRequest(
        "http://localhost/api/api-keys/00000000-0000-4000-8000-000000000001",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
      },
    );
    expect(response.status).toBe(204);
    expect(revokeMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      keyId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("404 voor een key van een ander team", async () => {
    revokeMock.mockResolvedValue(false);
    const response = await DELETE(
      new NextRequest(
        "http://localhost/api/api-keys/00000000-0000-4000-8000-000000000001",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
      },
    );
    expect(response.status).toBe(404);
  });
});
