import { beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/lib/redis";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));

const incrMock = vi.mocked(redis.incr);
const expireMock = vi.mocked(redis.expire);
const ttlMock = vi.mocked(redis.ttl);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkRateLimit (fixed window)", () => {
  it("laat de eerste request door en zet EXPIRE op de eerste hit", async () => {
    incrMock.mockResolvedValue(1);
    expireMock.mockResolvedValue(1);

    const result = await checkRateLimit("key:key-1", 120);

    expect(incrMock).toHaveBeenCalledWith("rl:key:key-1");
    expect(expireMock).toHaveBeenCalledWith("rl:key:key-1", 60);
    expect(result).toEqual({ ok: true });
  });

  it("binnen de limiet → ok, zonder extra EXPIRE", async () => {
    incrMock.mockResolvedValue(5);
    const result = await checkRateLimit("key:key-1", 120);
    expect(expireMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("boven de limiet → 429 met Retry-After (resterende ttl)", async () => {
    incrMock.mockResolvedValue(121);
    ttlMock.mockResolvedValue(30);

    const result = await checkRateLimit("key:key-1", 120);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 30 });
  });

  it("geeft minimaal 1s Retry-After als ttl ontbreekt", async () => {
    incrMock.mockResolvedValue(999);
    ttlMock.mockResolvedValue(-1);

    const result = await checkRateLimit("team:team-1", 60);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("gebruikt een eigen window", async () => {
    incrMock.mockResolvedValue(1);
    expireMock.mockResolvedValue(1);

    await checkRateLimit("key:key-1", 10, 120);

    expect(expireMock).toHaveBeenCalledWith("rl:key:key-1", 120);
  });
});
