import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Pool, QueryResult } from "pg";
import { getPublicStatus } from "../public-status-core";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeSite = {
  id: string;
  url: string;
  uptime_state: "up" | "down" | "unknown";
  public_status_slug: string | null;
};

type FakeEvent = {
  site_id: string;
  checked_at: Date;
  status: "up" | "down";
  error: string | null;
};

type FakeDaily = {
  site_id: string;
  day: string;
  checks: number;
  failures: number;
};

function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgoUtc(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return toUtcDay(d);
}

function fakePool(initialSites: FakeSite[] = []) {
  const sites: FakeSite[] = initialSites.map((s) => ({ ...s }));
  const events: FakeEvent[] = [];
  const daily: FakeDaily[] = [];

  const pool = {
    query: async (sql: string, params: unknown[] = []): Promise<QueryResultLike> => {
      const text = sql.replace(/\s+/g, " ").trim();

      if (text.startsWith("select id, url, uptime_state from sites")) {
        const [slug] = params;
        const s = sites.find((x) => x.public_status_slug === slug);
        return s
          ? { rowCount: 1, rows: [{ id: s.id, url: s.url, uptime_state: s.uptime_state }] }
          : { rowCount: 0, rows: [] };
      }

      if (text.startsWith("select day, checks, failures")) {
        const [siteId, start] = params as [string, string];
        const rows = daily
          .filter((d) => d.site_id === siteId && d.day >= start)
          .map((d) => ({ ...d }));
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("select checked_at, status")) {
        const [siteId, start] = params as [string, string];
        const from = new Date(`${start}T00:00:00Z`);
        const rows = events
          .filter((e) => e.site_id === siteId && e.checked_at >= from)
          .map((e) => ({ checked_at: e.checked_at, status: e.status }));
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("with ev as")) {
        const [siteId] = params;
        const sorted = events
          .filter((e) => e.site_id === siteId)
          .sort((a, b) => a.checked_at.getTime() - b.checked_at.getTime());
        const rows = [];
        let run: FakeEvent[] | null = null;
        for (const e of sorted) {
          if (e.status === "down") {
            run = run ?? [];
            run.push(e);
          } else if (run) {
            rows.push(incidentRow(run, e));
            run = null;
          }
        }
        if (run) rows.push(incidentRow(run, null));
        rows.reverse();
        return { rowCount: rows.length, rows };
      }

      throw new Error(`onbekende query: ${text}`);
    },
  };

  function incidentRow(run: FakeEvent[], nextUp: FakeEvent | null): Row {
    return {
      start: run[0].checked_at,
      end: nextUp?.checked_at ?? null,
      error: run.find((e) => e.error)?.error ?? null,
    };
  }

  return { pool: pool as unknown as Pool, sites, events, daily };
}

function makeSite(
  id: string,
  overrides: Partial<FakeSite> = {},
): FakeSite {
  return {
    id,
    url: "voorbeeld.nl",
    uptime_state: "up",
    public_status_slug: "abc123def4567890",
    ...overrides,
  };
}

describe("getPublicStatus", () => {
  it("retourneert null voor een onbekende slug", async () => {
    const f = fakePool([makeSite("site-1")]);
    const status = await getPublicStatus(f.pool, "onbekend");
    expect(status).toBeNull();
  });

  it("geeft null-uptime en een lege serie zonder metingen", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "unknown", public_status_slug: "slug-1" }),
    ]);
    const status = await getPublicStatus(f.pool, "slug-1");

    expect(status).not.toBeNull();
    expect(status!.site_host).toBe("voorbeeld.nl");
    expect(status!.status).toBe("unknown");
    expect(status!.uptime_30d).toBeNull();
    expect(status!.uptime_90d).toBeNull();
    expect(status!.incidents).toEqual([]);
    expect(status!.series).toHaveLength(30);
    expect(status!.series.every((s) => s.status === "nodata")).toBe(true);
  });

  it("berekent uptime-% uit uptime_daily + events van vandaag", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "up", public_status_slug: "slug-1" }),
    ]);
    const today = toUtcDay(new Date());
    f.daily.push(
      { site_id: "site-1", day: daysAgoUtc(2), checks: 1440, failures: 0 },
      { site_id: "site-1", day: daysAgoUtc(1), checks: 1440, failures: 10 },
    );
    f.events.push(
      { site_id: "site-1", checked_at: new Date(), status: "up", error: null },
      { site_id: "site-1", checked_at: new Date(Date.now() - 60_000), status: "up", error: null },
      { site_id: "site-1", checked_at: new Date(Date.now() - 120_000), status: "down", error: "timeout" },
    );

    const status = await getPublicStatus(f.pool, "slug-1");

    // 2 complete dagen (2880 checks, 10 failures) + vandaag (3 checks, 1 down)
    const total = 2880 + 3;
    const up = 2870 + 2;
    expect(status!.uptime_30d).toBeCloseTo((up / total) * 100, 2);
    expect(status!.uptime_90d).toBeCloseTo((up / total) * 100, 2);

    const todayBucket = status!.series.find((s) => s.day === today);
    expect(todayBucket?.status).toBe("down");
    const yesterday = status!.series.find((s) => s.day === daysAgoUtc(1));
    expect(yesterday?.status).toBe("down");
    const twoDays = status!.series.find((s) => s.day === daysAgoUtc(2));
    expect(twoDays?.status).toBe("up");
  });

  it("bouwt een 90-dagen-serie met nodata voor dagen zonder meting", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "up", public_status_slug: "slug-1" }),
    ]);
    f.daily.push({ site_id: "site-1", day: daysAgoUtc(60), checks: 1440, failures: 0 });

    const status = await getPublicStatus(f.pool, "slug-1", 90);

    expect(status!.series).toHaveLength(90);
    expect(status!.series.find((s) => s.day === daysAgoUtc(60))?.status).toBe("up");
    expect(status!.series[0].day).toBe(daysAgoUtc(89));
  });

  it("groepeert opeenvolgende down-events tot één incident", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "up", public_status_slug: "slug-1" }),
    ]);
    const now = Date.now();
    f.events.push(
      { site_id: "site-1", checked_at: new Date(now - 30 * 60_000), status: "up", error: null },
      { site_id: "site-1", checked_at: new Date(now - 29 * 60_000), status: "down", error: "timeout" },
      { site_id: "site-1", checked_at: new Date(now - 28 * 60_000), status: "down", error: "timeout" },
      { site_id: "site-1", checked_at: new Date(now - 20 * 60_000), status: "up", error: null },
    );

    const status = await getPublicStatus(f.pool, "slug-1");

    expect(status!.incidents).toHaveLength(1);
    expect(status!.incidents[0].error_class).toBe("timeout");
    expect(status!.incidents[0].end).not.toBeNull();
    expect(
      new Date(status!.incidents[0].end!).getTime() - new Date(status!.incidents[0].start).getTime(),
    ).toBe(9 * 60_000);
  });

  it("geeft een lopend incident zonder eindtijd", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "down", public_status_slug: "slug-1" }),
    ]);
    f.events.push(
      { site_id: "site-1", checked_at: new Date(Date.now() - 10 * 60_000), status: "down", error: "http-5xx" },
    );

    const status = await getPublicStatus(f.pool, "slug-1");

    expect(status!.incidents).toHaveLength(1);
    expect(status!.incidents[0].end).toBeNull();
    expect(status!.incidents[0].error_class).toBe("http-5xx");
  });

  it("bevat geen findings/scores/team-internals", async () => {
    const f = fakePool([
      makeSite("site-1", { uptime_state: "up", public_status_slug: "slug-1" }),
    ]);
    const status = await getPublicStatus(f.pool, "slug-1");

    expect(Object.keys(status!)).toEqual(
      expect.arrayContaining([
        "site_host",
        "status",
        "uptime_30d",
        "uptime_90d",
        "series",
        "incidents",
      ]),
    );
    expect(status!).not.toHaveProperty("findings");
    expect(status!).not.toHaveProperty("score");
    expect(status!).not.toHaveProperty("team_id");
    expect(status!).not.toHaveProperty("url");
  });
});