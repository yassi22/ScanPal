import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db";
import {
  API_KEY_PREFIX,
  createApiKey,
  findApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  recordApiKeyUsage,
  revokeApiKey,
} from "@/lib/api-keys-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

const queryMock = vi.mocked(pool.query);

beforeEach(() => {
  queryMock.mockReset();
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    team_id: "team-1",
    created_by: "user-1",
    name: "CI",
    prefix: "sp_live_AbCdEf",
    key_hash: "a".repeat(64),
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    created_at: new Date("2026-08-16T08:00:00Z"),
    ...overrides,
  };
}

describe("generateApiKey / hashApiKey", () => {
  it("genereert een key met sp_live_-prefix en 32 random bytes", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(8 + 43);
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  it("hasht naar een unieke 64-hex sha256 (nooit de plaintext)", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(hash);
    expect(hashApiKey(`${key}x`)).not.toBe(hash);
  });
});

describe("createApiKey", () => {
  it("slaat alleen de hash op en retourneert de full key 1×", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow()] } as never);

    const result = await createApiKey(pool, {
      teamId: "team-1",
      createdBy: "user-1",
      name: "CI",
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("insert into api_keys");
    expect(String(sql)).not.toContain(result.fullKey);
    expect(params).toHaveLength(5);
    expect(params![4]).toMatch(/^[0-9a-f]{64}$/);

    expect(result.fullKey.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(result.view.name).toBe("CI");
    expect(result.view.prefix).toBe("sp_live_AbCdEf");
    expect(result.view.prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(Object.keys(result.view)).not.toContain("key_hash");
  });
});

describe("listApiKeys / revokeApiKey / findApiKey", () => {
  it("lijst is team-scoped en bevat geen hashes", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow()] } as never);

    const keys = await listApiKeys(pool, "team-1");

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("where team_id = $1");
    expect(params![0]).toBe("team-1");
    expect(keys).toHaveLength(1);
    expect(keys[0].prefix).toBe("sp_live_AbCdEf");
    expect(keys[0]).not.toHaveProperty("key_hash");
  });

  it("revoke is soft en alleen binnen het eigen team", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);
    const ok = await revokeApiKey(pool, { teamId: "team-1", keyId: "key-1" });
    expect(ok).toBe(true);

    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    const miss = await revokeApiKey(pool, { teamId: "team-2", keyId: "key-1" });
    expect(miss).toBe(false);

    const [sql, params] = queryMock.mock.calls[1];
    expect(String(sql)).toContain("revoked_at = now()");
    expect(params).toEqual(["key-1", "team-2"]);
  });

  it("findApiKey zoekt op hash en retourneert null bij geen match", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow()] } as never);
    const row = await findApiKey(pool, "a".repeat(64));
    expect(row?.team_id).toBe("team-1");

    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    expect(await findApiKey(pool, "b".repeat(64))).toBeNull();
  });

  it("recordApiKeyUsage verhoogt de dag-teller (upsert)", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [] } as never);
    await recordApiKeyUsage(pool, "key-1");

    const [updateSql] = queryMock.mock.calls[0];
    const [insertSql] = queryMock.mock.calls[1];
    expect(String(updateSql)).toContain("update api_keys set last_used_at");
    expect(String(insertSql)).toContain("on conflict (key_id, day)");
    expect(String(insertSql)).toContain("request_count = api_key_usage.request_count + 1");
  });
});
