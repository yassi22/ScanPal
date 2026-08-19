import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Pool, QueryResult } from "pg";
import {
  getUptimeDetail,
  listUptimeSummaries,
  setUptimeMonitoring,
} from "../uptime-core";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeSite = {
  id: string;
  team_id: string;
  url: string;
  label: string | null;
  uptime_state: "up" | "down" | "unknown";
  uptime_state_changed_at: Date | null;
  uptime_enabled: boolean;
};

type FakeEvent = {
  site_id: string;
  checked_at: Date;
  status: "up" | "down";
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
};

type FakeDaily = {
  site_id: string;
  day: string;
  checks: number;
  failures: number;
  avg_latency_ms: number | null;
};

function makeSite(
  id: string,
  teamId: string,
  overrides: Partial<FakeSite> = {},
): FakeSite {
  return {
    id,
    team_id: teamId,
    url: `${id}.example.com`,
    label: null,
    uptime_state: "unknown",
    uptime_state_changed_at: null,
    uptime_enabled: true,
    ...overrides,
  };
}

function makeEvent(
  siteId: string,
  overrides: Partial<FakeEvent> = {},
): FakeEvent {
  return {
    site_id: siteId,
    checked_at: new Date("2026-08-16T09:00:00Z"),
    status: "up",
    latency_ms: 100,
    status_code: 200,
    error: null,
    ...overrides,
  };
}

function fakePool(initialSites: FakeSite[] = []) {
  const sites: FakeSite[] = initialSites.map((s) => ({ ...s }));
  const events: FakeEvent[] = [];
  const daily: FakeDaily[] = [];

  function aggFor(site: FakeSite, hours: number) {
    const cutoff = new Date(Date.now() - hours * 3600 * 1000);
    const siteEvents = events.filter(
      (e) => e.site_id === site.id && e.checked_at > cutoff,
    );
    const ups = siteEvents.filter((e) => e.status === "up").length;
    const latencies = siteEvents
      .map((e) => e.latency_ms)
      .filter((l): l is number => l !== null)
      .sort((a, b) => a - b);
    const avg =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : null;
    const p95 =
      latencies.length > 0
        ? latencies[Math.floor(latencies.length * 0.95)]
        : null;
    return { ups, total: siteEvents.length, avg, p95 };
  }

  const pool = {
    query: async (sql: string, params: unknown[] = []): Promise<QueryResultLike> => {
      const text = sql.replace(/\s+/g, " ").trim();

      if (text.startsWith("select s.id as site_id")) {
        if (params.length === 2) {
          const [teamId, siteId] = params;
          const s = sites.find((x) => x.team_id === teamId && x.id === siteId);
          if (!s) return { rowCount: 0, rows: [] };
          const a24 = aggFor(s, 24);
          const a30 = aggFor(s, 24 * 30);
          return {
            rowCount: 1,
            rows: [
              {
                site_id: s.id,
                url: s.url,
                label: s.label,
                uptime_state: s.uptime_state,
                uptime_state_changed_at: s.uptime_state_changed_at,
                last_checked_at: events.filter((event) => event.site_id === s.id).sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime())[0]?.checked_at ?? null,
                probe_fresh: events.some((event) => event.site_id === s.id && event.checked_at.getTime() > Date.now() - 3 * 60 * 1000),
                uptime_enabled: s.uptime_enabled,
                up24: a24.ups,
                total24: a24.total,
                avg_latency_24: a24.avg,
                p95_latency_24: a24.p95,
                up30: a30.ups,
                total30: a30.total,
                team_id: s.team_id,
              },
            ],
          };
        }
        const [teamId] = params;
        const rows = sites
          .filter((s) => s.team_id === teamId)
          .map((s) => {
            const a24 = aggFor(s, 24);
            const a30 = aggFor(s, 24 * 30);
            return {
              site_id: s.id,
              url: s.url,
              label: s.label,
              uptime_state: s.uptime_state,
              uptime_state_changed_at: s.uptime_state_changed_at,
              last_checked_at: events.filter((event) => event.site_id === s.id).sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime())[0]?.checked_at ?? null,
              probe_fresh: events.some((event) => event.site_id === s.id && event.checked_at.getTime() > Date.now() - 3 * 60 * 1000),
              uptime_enabled: s.uptime_enabled,
              up24: a24.ups,
              total24: a24.total,
              avg_latency_24: a24.avg,
              p95_latency_24: a24.p95,
              up30: a30.ups,
              total30: a30.total,
            };
          });
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("select e.site_id")) {
        const [teamId] = params;
        const buckets = new Map<string, { ups: number; total: number; latencies: number[] }>();
        for (const e of events.filter((ev) => sites.find((s) => s.id === ev.site_id)?.team_id === teamId)) {
          const key = `${e.site_id}:${new Date(Math.floor(e.checked_at.getTime() / 3600000) * 3600000).toISOString()}`;
          const b = buckets.get(key) ?? { ups: 0, total: 0, latencies: [] };
          b.total++;
          if (e.status === "up") b.ups++;
          if (e.latency_ms !== null) b.latencies.push(e.latency_ms);
          buckets.set(key, b);
        }
        const rows = [...buckets.entries()].map(([key, b]) => {
          const idx = key.indexOf(":");
          const siteId = key.slice(0, idx);
          return {
            site_id: siteId,
            bucket: new Date(key.slice(idx + 1)),
            ups: b.ups,
            total: b.total,
            avg_latency: b.latencies.length ? b.latencies.reduce((a, c) => a + c, 0) / b.latencies.length : null,
          };
        });
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("select date_trunc('hour', e.checked_at)")) {
        const [siteId] = params;
        const siteEvents = events.filter((e) => e.site_id === siteId);
        const buckets = new Map<string, { ups: number; total: number; latencies: number[] }>();
        for (const e of siteEvents) {
          const key = new Date(Math.floor(e.checked_at.getTime() / 3600000) * 3600000).toISOString();
          const b = buckets.get(key) ?? { ups: 0, total: 0, latencies: [] };
          b.total++;
          if (e.status === "up") b.ups++;
          if (e.latency_ms !== null) b.latencies.push(e.latency_ms);
          buckets.set(key, b);
        }
        const rows = [...buckets.entries()].map(([key, b]) => ({
          bucket: new Date(key),
          ups: b.ups,
          total: b.total,
          avg_latency: b.latencies.length ? b.latencies.reduce((a, c) => a + c, 0) / b.latencies.length : null,
        }));
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("select d.day as bucket")) {
        const [siteId] = params;
        const rows = daily
          .filter((d) => d.site_id === siteId)
          .map((d) => ({
            bucket: new Date(`${d.day}T00:00:00Z`),
            ups: d.checks - d.failures,
            total: d.checks,
            avg_latency: d.avg_latency_ms,
          }));
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("select id, site_id, checked_at")) {
        const [siteId] = params;
        const rows = events
          .filter((e) => e.site_id === siteId)
          .sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime())
          .slice(0, 20)
          .map((e) => ({ ...e }));
        return { rowCount: rows.length, rows };
      }

      if (text.startsWith("select e.checked_at as started_at")) {
        const [siteId] = params;
        const down = events
          .filter((e) => e.site_id === siteId && e.status === "down")
          .sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime())[0];
        if (!down) return { rowCount: 0, rows: [] };
        const nextUp = events
          .filter(
            (e) =>
              e.site_id === siteId &&
              e.status === "up" &&
              e.checked_at > down.checked_at,
          )
          .sort((a, b) => a.checked_at.getTime() - b.checked_at.getTime())[0];
        return {
          rowCount: 1,
          rows: [
            { started_at: down.checked_at, ended_at: nextUp?.checked_at ?? null },
          ],
        };
      }

      if (text.startsWith("update sites set uptime_enabled")) {
        const [siteId, teamId, enabled] = params as [string, string, boolean];
        const site = sites.find((s) => s.id === siteId && s.team_id === teamId);
        if (site) site.uptime_enabled = enabled;
        return { rowCount: site ? 1 : 0, rows: [] };
      }

      throw new Error(`onbekende query: ${text}`);
    },
  };

  return { pool: pool as unknown as Pool, sites, events, daily };
}

describe("listUptimeSummaries", () => {
  it("retourneert per site status, uptime% en sparkline", async () => {
    const f = fakePool([
      makeSite("site-1", "team-1", {
        uptime_state: "up",
        uptime_state_changed_at: new Date("2026-08-16T08:00:00Z"),
      }),
      makeSite("site-2", "team-1", { uptime_enabled: false }),
      makeSite("site-ander", "team-2"),
    ]);
    const hour = 3600 * 1000;
    f.events.push(
      makeEvent("site-1", {
        checked_at: new Date(Date.now() - 3 * hour),
        status: "up",
        latency_ms: 100,
      }),
      makeEvent("site-1", {
        checked_at: new Date(Date.now() - 1 * hour),
        status: "down",
        latency_ms: null,
        error: "timeout",
      }),
      makeEvent("site-2", {
        checked_at: new Date(Date.now() - 1 * hour),
        status: "up",
        latency_ms: 50,
      }),
    );

    const summaries = await listUptimeSummaries(f.pool, "team-1");

    expect(summaries).toHaveLength(2);
    const s1 = summaries.find((s) => s.site_id === "site-1");
    expect(s1?.uptime_state).toBe("up");
    expect(s1?.uptime_state_changed_at).toBe("2026-08-16T08:00:00.000Z");
    expect(s1?.uptime_24h_pct).toBe(50);
    expect(s1?.uptime_30d_pct).toBe(50);
    expect(s1?.avg_latency_ms_24h).toBe(100);
    expect(s1?.p95_latency_ms_24h).toBe(100);
    expect(s1?.sparkline).toHaveLength(2);
    expect(s1?.sparkline[0].at).toMatch(/Z$/);
    expect(s1?.sparkline[0].up_pct).toBe(100);
    expect(s1?.sparkline[1].up_pct).toBe(0);

    const s2 = summaries.find((s) => s.site_id === "site-2");
    expect(s2?.uptime_24h_pct).toBe(100);
    expect(s2?.uptime_enabled).toBe(false);
  });

  it("geeft null-percentages zolang er geen events zijn", async () => {
    const f = fakePool([makeSite("site-1", "team-1")]);
    const summaries = await listUptimeSummaries(f.pool, "team-1");
    expect(summaries[0].uptime_24h_pct).toBeNull();
    expect(summaries[0].uptime_30d_pct).toBeNull();
    expect(summaries[0].avg_latency_ms_24h).toBeNull();
    expect(summaries[0].sparkline).toEqual([]);
  });
});

describe("getUptimeDetail", () => {
  it("retourneert null voor een site van een ander team", async () => {
    const f = fakePool([makeSite("site-1", "team-2")]);
    const detail = await getUptimeDetail(f.pool, "team-1", "site-1", 30);
    expect(detail).toBeNull();
  });

  it("geeft 30d-uurbuckets uit events", async () => {
    const f = fakePool([makeSite("site-1", "team-1")]);
    f.events.push(
      makeEvent("site-1", { checked_at: new Date("2026-08-16T09:30:00Z") }),
      makeEvent("site-1", {
        checked_at: new Date("2026-08-16T09:45:00Z"),
        status: "down",
        latency_ms: null,
        error: "timeout",
      }),
      makeEvent("site-1", { checked_at: new Date("2026-08-16T11:00:00Z") }),
    );

    const detail = await getUptimeDetail(f.pool, "team-1", "site-1", 30);

    expect(detail).not.toBeNull();
    expect(detail!.series).toHaveLength(2);
    expect(detail!.series[0].up_pct).toBe(50);
    expect(detail!.series[1].up_pct).toBe(100);
  });

  it("geeft 90d-dagbuckets uit uptime_daily", async () => {
    const f = fakePool([makeSite("site-1", "team-1")]);
    f.daily.push(
      { site_id: "site-1", day: "2026-08-15", checks: 1440, failures: 2, avg_latency_ms: 90 },
      { site_id: "site-1", day: "2026-08-16", checks: 1440, failures: 0, avg_latency_ms: 80 },
    );

    const detail = await getUptimeDetail(f.pool, "team-1", "site-1", 90);

    expect(detail!.series).toHaveLength(2);
    expect(detail!.series[0].up_pct).toBeCloseTo(99.86);
    expect(detail!.series[1].up_pct).toBe(100);
    expect(detail!.series[1].avg_latency_ms).toBe(80);
  });

  it("bevat recente events (max 20) en het laatste incident", async () => {
    const f = fakePool([makeSite("site-1", "team-1")]);
    f.events.push(
      makeEvent("site-1", {
        checked_at: new Date("2026-08-16T08:00:00Z"),
        status: "down",
        latency_ms: null,
        error: "timeout",
      }),
      makeEvent("site-1", {
        checked_at: new Date("2026-08-16T08:01:00Z"),
        status: "up",
      }),
    );

    const detail = await getUptimeDetail(f.pool, "team-1", "site-1", 30);

    expect(detail!.recent_events).toHaveLength(2);
    expect(detail!.recent_events[0].status).toBe("up");
    expect(detail!.recent_events[0].checked_at).toMatch(/Z$/);
    expect(detail!.last_incident).toEqual({
      started_at: "2026-08-16T08:00:00.000Z",
      ended_at: "2026-08-16T08:01:00.000Z",
    });
  });

  it("geeft een lopend incident zonder eindtijd", async () => {
    const f = fakePool([makeSite("site-1", "team-1")]);
    f.events.push(
      makeEvent("site-1", {
        checked_at: new Date("2026-08-16T08:00:00Z"),
        status: "down",
        latency_ms: null,
        error: "timeout",
      }),
    );
    const detail = await getUptimeDetail(f.pool, "team-1", "site-1", 30);
    expect(detail!.last_incident).toEqual({
      started_at: "2026-08-16T08:00:00.000Z",
      ended_at: null,
    });
  });
});

describe("setUptimeMonitoring", () => {
  it("zet de toggle aan/uit voor een eigen site", async () => {
    const f = fakePool([makeSite("site-1", "team-1")]);
    const ok = await setUptimeMonitoring(f.pool, "team-1", "site-1", false);
    expect(ok).toBe(true);
    expect(f.sites[0].uptime_enabled).toBe(false);
  });

  it("geeft false voor een site van een ander team", async () => {
    const f = fakePool([makeSite("site-1", "team-2")]);
    const ok = await setUptimeMonitoring(f.pool, "team-1", "site-1", false);
    expect(ok).toBe(false);
  });
});
