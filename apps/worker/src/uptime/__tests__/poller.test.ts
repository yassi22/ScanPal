import { describe, it, expect, vi } from "vitest";
import type { Pool, QueryResult } from "pg";
import { pollAllSites } from "../poller";
import type { ProbeResult } from "../probe";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeSite = {
  id: string;
  team_id: string;
  url: string;
  uptime_state: "up" | "down" | "unknown";
  uptime_enabled: boolean;
  uptime_state_changed_at: Date | null;
};

type FakeEvent = {
  site_id: string;
  status: "up" | "down";
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
};

function makeSite(
  id: string,
  overrides: Partial<FakeSite> = {},
): FakeSite {
  return {
    id,
    team_id: "team-1",
    url: `${id}.example.com`,
    uptime_state: "unknown",
    uptime_enabled: true,
    uptime_state_changed_at: null,
    ...overrides,
  };
}

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

function fakePool(initialSites: FakeSite[] = []) {
  const sites: FakeSite[] = initialSites.map((s) => ({ ...s }));
  const events: FakeEvent[] = [];
  let transactionOpen = false;
  let failOnEventInsert = false;

  const client = {
    query: async (sql: string, params: unknown[] = []): Promise<QueryResultLike> => {
      const text = sql.replace(/\s+/g, " ").trim();

      if (text === "begin") {
        transactionOpen = true;
        return { rowCount: 1, rows: [] };
      }
      if (text === "commit") {
        transactionOpen = false;
        return { rowCount: 1, rows: [] };
      }
      if (text === "rollback") {
        transactionOpen = false;
        return { rowCount: 1, rows: [] };
      }

      if (text.startsWith("select count(*)::int as n")) {
        const siteId = params[0];
        const siteEvents = events.filter((e) => e.site_id === siteId);
        let n = 0;
        for (const event of siteEvents.reverse()) {
          if (event.status === "down") n++;
          else break;
        }
        return { rowCount: 1, rows: [{ n }] };
      }

      if (text.startsWith("insert into uptime_events")) {
        if (failOnEventInsert) throw new Error("insert mislukt");
        const [siteId, status, latencyMs, statusCode, error] = params as [
          string,
          "up" | "down",
          number | null,
          number | null,
          string | null,
        ];
        events.push({ site_id: siteId, status, latency_ms: latencyMs, status_code: statusCode, error });
        return { rowCount: 1, rows: [] };
      }

      if (text.startsWith("update sites")) {
        const siteId = params[0];
        const site = sites.find((s) => s.id === siteId);
        if (site) {
          site.uptime_state = params[1] as FakeSite["uptime_state"];
          site.uptime_state_changed_at = params[2] as Date;
        }
        return { rowCount: site ? 1 : 0, rows: [] };
      }

      throw new Error(`onbekende query in fake pool: ${text}`);
    },
    release: () => {},
  };

  const pool = {
    connect: async () => client,
    query: async (sql: string): Promise<QueryResultLike> => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("select id, team_id, url, uptime_state, uptime_state_changed_at")) {
        const rows = sites
          .filter((s) => s.uptime_enabled)
          .map((s) => ({
            id: s.id,
            team_id: s.team_id,
            url: s.url,
            uptime_state: s.uptime_state,
            uptime_state_changed_at: s.uptime_state_changed_at,
          }));
        return { rowCount: rows.length, rows };
      }
      throw new Error(`onbekende pool-query: ${text}`);
    },
  };

  return {
    pool: pool as unknown as Pool,
    client,
    sites,
    events,
    setFailOnEventInsert(value: boolean) {
      failOnEventInsert = value;
    },
    get isTransactionOpen() {
      return transactionOpen;
    },
  };
}

function probe(ok: boolean): (url: string) => Promise<ProbeResult> {
  return async () => ({
    ok,
    status: ok ? "up" : "down",
    latency_ms: ok ? 100 : null,
    status_code: ok ? 200 : null,
    error: ok ? null : "connect",
  });
}

const NOW = new Date("2026-08-16T09:00:00Z");

describe("pollAllSites", () => {
  it("probeert alle sites met monitoring aan en schrijft events", async () => {
    const f = fakePool([makeSite("site-1"), makeSite("site-2", { uptime_enabled: false })]);
    const redis = new FakeRedis();
    const probeSpy = vi.fn(probe(true));

    const result = await pollAllSites({
      db: f.pool,
      redis,
      probe: probeSpy,
      now: NOW,
    });

    expect(result.probed).toEqual(["site-1"]);
    expect(result.skippedLocked).toEqual([]);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      site_id: "site-1",
      status: "up",
      latency_ms: 100,
      status_code: 200,
      error: null,
    });
  });

  it("eerste probe ooit: failure → down met changed_at", async () => {
    const f = fakePool([makeSite("site-1")]);
    const redis = new FakeRedis();

    await pollAllSites({ db: f.pool, redis, probe: probe(false), now: NOW });

    expect(f.sites[0].uptime_state).toBe("down");
    expect(f.sites[0].uptime_state_changed_at).toEqual(NOW);
  });

  it("2e opeenvolgende failure → down; 1e failure blijft up", async () => {
    const f = fakePool([
      makeSite("site-1", {
        uptime_state: "up",
        uptime_state_changed_at: new Date("2026-08-10T00:00:00Z"),
      }),
    ]);
    const redis = new FakeRedis();
    f.events.push({
      site_id: "site-1",
      status: "down",
      latency_ms: null,
      status_code: null,
      error: "timeout",
    });

    await pollAllSites({ db: f.pool, redis, probe: probe(false), now: NOW });
    expect(f.sites[0].uptime_state).toBe("down");
    expect(f.sites[0].uptime_state_changed_at).toEqual(NOW);
    expect(f.events).toHaveLength(2);
  });

  it("1e failure na up (zonder eerdere down-events) laat status up", async () => {
    const f = fakePool([
      makeSite("site-1", {
        uptime_state: "up",
        uptime_state_changed_at: new Date("2026-08-10T00:00:00Z"),
      }),
    ]);
    const redis = new FakeRedis();

    await pollAllSites({ db: f.pool, redis, probe: probe(false), now: NOW });

    expect(f.sites[0].uptime_state).toBe("up");
    expect(f.events[0].status).toBe("down");
  });

  it("herstel na 1 succes: down → up met changed_at", async () => {
    const f = fakePool([
      makeSite("site-1", {
        uptime_state: "down",
        uptime_state_changed_at: new Date("2026-08-15T10:00:00Z"),
      }),
    ]);
    const redis = new FakeRedis();
    f.events.push(
      { site_id: "site-1", status: "down", latency_ms: null, status_code: null, error: "timeout" },
      { site_id: "site-1", status: "down", latency_ms: null, status_code: null, error: "timeout" },
    );

    await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW });

    expect(f.sites[0].uptime_state).toBe("up");
    expect(f.sites[0].uptime_state_changed_at).toEqual(NOW);
  });

  it("slaat sites over waarvan de lock bezet is", async () => {
    const f = fakePool([makeSite("site-1"), makeSite("site-2")]);
    const redis = new FakeRedis();
    await redis.set("uptime:lock:site-2", "ander-token", "EX", 15, "NX");

    const result = await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW });

    expect(result.probed).toEqual(["site-1"]);
    expect(result.skippedLocked).toEqual(["site-2"]);
    expect(f.events).toHaveLength(1);
  });

  it("geeft de lock altijd vrij na een probe", async () => {
    const f = fakePool([makeSite("site-1")]);
    const redis = new FakeRedis();

    await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW });

    expect(redis.store.has("uptime:lock:site-1")).toBe(false);
  });

  it("geeft de lock vrij en registreert een fout als het schrijven faalt", async () => {
    const f = fakePool([makeSite("site-1")]);
    const redis = new FakeRedis();
    f.setFailOnEventInsert(true);

    const result = await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW });

    expect(result.failed).toEqual(["site-1"]);
    expect(redis.store.has("uptime:lock:site-1")).toBe(false);
    expect(f.isTransactionOpen).toBe(false);
  });

  it("werkt met meerdere sites achter elkaar", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "up" }),
      makeSite("site-2", { uptime_state: "up" }),
      makeSite("site-3", { uptime_state: "up" }),
    ]);
    const redis = new FakeRedis();

    const result = await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW });

    expect(result.probed).toHaveLength(3);
    expect(f.events).toHaveLength(3);
    expect(redis.store.size).toBe(0);
  });

  it("down-transitie stuurt een site_down-notificatie (incident-id = tijdstip)", async () => {
    const f = fakePool([makeSite("site-1")]);
    const redis = new FakeRedis();
    const notify = vi.fn();

    await pollAllSites({ db: f.pool, redis, probe: probe(false), now: NOW, notify });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "site_down",
      teamId: "team-1",
      entityId: "site-1",
      incidentId: NOW.toISOString(),
      payload: { site_name: "site-1.example.com" },
    });
  });

  it("herstel stuurt een site_recovered-notificatie (incident-id = down-tijdstip)", async () => {
    const f = fakePool([
      makeSite("site-1", {
        uptime_state: "down",
        uptime_state_changed_at: new Date("2026-08-15T10:00:00Z"),
      }),
    ]);
    const redis = new FakeRedis();
    f.events.push(
      { site_id: "site-1", status: "down", latency_ms: null, status_code: null, error: "timeout" },
      { site_id: "site-1", status: "down", latency_ms: null, status_code: null, error: "timeout" },
    );
    const notify = vi.fn();

    await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW, notify });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "site_recovered",
      teamId: "team-1",
      entityId: "site-1",
      incidentId: "2026-08-15T10:00:00.000Z",
      payload: { site_name: "site-1.example.com" },
    });
  });

  it("zonder state-transitie wordt geen notificatie verstuurd", async () => {
    const f = fakePool([makeSite("site-1", { uptime_state: "up" })]);
    const redis = new FakeRedis();
    const notify = vi.fn();

    await pollAllSites({ db: f.pool, redis, probe: probe(true), now: NOW, notify });

    expect(notify).not.toHaveBeenCalled();
  });

  it("een mislukte notificatie breekt de poll niet", async () => {
    const f = fakePool([makeSite("site-1")]);
    const redis = new FakeRedis();
    const notify = vi.fn().mockRejectedValue(new Error("mail kapot"));

    const result = await pollAllSites({
      db: f.pool,
      redis,
      probe: probe(false),
      now: NOW,
      notify,
      log: () => {},
    });

    expect(result.probed).toEqual(["site-1"]);
    expect(result.failed).toEqual([]);
    expect(f.sites[0].uptime_state).toBe("down");
    expect(redis.store.size).toBe(0);
  });
});
