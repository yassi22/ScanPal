import { describe, it, expect } from "vitest";
import type { Pool, QueryResult } from "pg";
import { runUptimeMaintenance } from "../maintenance";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

class FakeRedis {
  store = new Map<string, string>();

  async set(
    key: string,
    value: string,
    _mode: "EX",
    _ttlSeconds: number,
    _nx: "NX",
  ): Promise<"OK" | null> {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }

  async eval(script: string, numKeys: number, ...args: string[]): Promise<number> {
    const key = args[0];
    const token = args[1];
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

function fakePool() {
  const calls: string[] = [];
  const pool = {
    query: async (sql: string): Promise<QueryResultLike> => {
      const text = sql.replace(/\s+/g, " ").trim();
      calls.push(text);
      if (text.startsWith("with agg as")) {
        return { rowCount: 5, rows: [] };
      }
      if (text.startsWith("delete from uptime_events")) {
        return { rowCount: 3, rows: [] };
      }
      throw new Error(`onbekende query: ${text}`);
    },
  };
  return { pool: pool as unknown as Pool, calls };
}

const NOW = new Date("2026-08-16T09:00:00Z");

describe("runUptimeMaintenance", () => {
  it("rollupt compleet dagen en ruimt events ouder dan 30 dagen op", async () => {
    const f = fakePool();
    const redis = new FakeRedis();

    const result = await runUptimeMaintenance({ db: f.pool, redis, now: NOW });

    expect(result).toEqual({ rolledUpDays: 5, deletedEvents: 3, skipped: false });
    expect(f.calls[0]).toContain("insert into uptime_daily");
    expect(f.calls[0]).toContain("on conflict (site_id, day) do update");
    expect(f.calls[0]).toContain("checked_at < date_trunc('day', $1::timestamptz)");
    expect(f.calls[1]).toContain("interval '30 days'");
  });

  it("is idempotent — een tweede run geeft hetzelfde resultaat", async () => {
    const f = fakePool();
    const redis = new FakeRedis();

    const first = await runUptimeMaintenance({ db: f.pool, redis, now: NOW });
    const second = await runUptimeMaintenance({ db: f.pool, redis, now: NOW });

    expect(first).toEqual(second);
    expect(f.calls).toHaveLength(4);
  });

  it("slaat over als de maintenance-lock bezet is", async () => {
    const f = fakePool();
    const redis = new FakeRedis();
    await redis.set("uptime:maintenance", "ander-token", "EX", 3600, "NX");

    const result = await runUptimeMaintenance({ db: f.pool, redis, now: NOW });

    expect(result).toEqual({ rolledUpDays: 0, deletedEvents: 0, skipped: true });
    expect(f.calls).toHaveLength(0);
  });

  it("geeft de lock altijd vrij", async () => {
    const f = fakePool();
    const redis = new FakeRedis();

    await runUptimeMaintenance({ db: f.pool, redis, now: NOW });

    expect(redis.store.has("uptime:maintenance")).toBe(false);
  });
});
