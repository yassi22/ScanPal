import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { processDueSites, type SchedulerNotifier, type DueSite } from "../core";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeSite = Omit<DueSite, "scan_frequency"> & {
  scan_frequency: string;
  last_scan_status: string | null;
};

type FakeScan = {
  id: string;
  site_id: string;
  status: string;
  trigger: string;
  scheduled_for: Date | null;
  created_at: Date;
};

function makeSite(
  id: string,
  overrides: Partial<FakeSite> = {},
): FakeSite {
  return {
    id,
    team_id: "team-1",
    url: `${id}.example.com`,
    scan_frequency: "daily",
    next_scan_at: new Date("2026-08-15T09:00:00Z"),
    last_scan_status: null,
    ...overrides,
  };
}

function fakePool() {
  let scanSeq = 0;
  const sites: FakeSite[] = [];
  const scans: FakeScan[] = [];
  const subscriptions = new Map<string, { credits_used: number }>();
  let snapshot: {
    sites: FakeSite[];
    scans: FakeScan[];
    subscriptions: Map<string, { credits_used: number }>;
  } | null = null;

  function handle(sql: string, params: unknown[] = []): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();
    const [a] = params as [string];

    if (text === "begin") {
      snapshot = {
        sites: sites.map((s) => ({ ...s })),
        scans: scans.map((s) => ({ ...s })),
        subscriptions: new Map(subscriptions),
      };
      return { rowCount: 1, rows: [] };
    }
    if (text === "commit") {
      snapshot = null;
      return { rowCount: 1, rows: [] };
    }
    if (text === "rollback") {
      if (snapshot) {
        sites.splice(0, sites.length, ...snapshot.sites);
        scans.splice(0, scans.length, ...snapshot.scans);
        subscriptions.clear();
        for (const [k, v] of snapshot.subscriptions) subscriptions.set(k, { ...v });
        snapshot = null;
      }
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select id, team_id, url, scan_frequency, next_scan_at")) {
      const rows = sites
        .filter((s) => s.scan_frequency !== "none")
        .map((s) => ({
          id: s.id,
          team_id: s.team_id,
          url: s.url,
          scan_frequency: s.scan_frequency,
          next_scan_at: s.next_scan_at,
        }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("select 1 from scans")) {
      const active = scans.some(
        (sc) => sc.site_id === a && (sc.status === "queued" || sc.status === "running"),
      );
      return active ? { rowCount: 1, rows: [{ 1: 1 }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("insert into scans")) {
      const scan: FakeScan = {
        id: `scan-${++scanSeq}`,
        site_id: a,
        status: "queued",
        trigger: "schedule",
        scheduled_for: params[1] as Date | null,
        created_at: new Date(),
      };
      scans.push(scan);
      return { rowCount: 1, rows: [{ id: scan.id }] };
    }

    if (text.startsWith("update sites set last_scan_id")) {
      const site = sites.find((s) => s.id === params[2]);
      if (site) site.last_scan_status = params[1] as string;
      return { rowCount: site ? 1 : 0, rows: [] };
    }

    if (text.startsWith("update sites set next_scan_at")) {
      const [next, siteId] = params as [Date, string];
      const site = sites.find((s) => s.id === siteId);
      if (site) site.next_scan_at = next;
      return { rowCount: site ? 1 : 0, rows: [] };
    }

    if (text.startsWith("insert into subscriptions")) {
      if (!subscriptions.has(a)) subscriptions.set(a, { credits_used: 0 });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("update subscriptions set credits_used = credits_used + 1")) {
      const sub = subscriptions.get(a);
      const limit = params[1] as number;
      if (!sub || sub.credits_used >= limit) return { rowCount: 0, rows: [] };
      sub.credits_used += 1;
      return { rowCount: 1, rows: [{ credits_used: sub.credits_used }] };
    }

    if (text.startsWith("update subscriptions set credits_used = 0")) {
      const sub = subscriptions.get(a);
      if (sub) sub.credits_used = 0;
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    if (text.startsWith("insert into credit_transactions")) {
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select plan, status, current_period_end, credits_used")) {
      const sub = subscriptions.get(a);
      return sub
        ? {
            rowCount: 1,
            rows: [
              {
                plan: "free",
                status: "active",
                current_period_end: new Date(Date.now() + 86400000),
                credits_used: sub.credits_used,
              },
            ],
          }
        : { rowCount: 0, rows: [] };
    }

    throw new Error(`Onverwachte query in test-fake: ${text}`);
  }

  const client = {
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
    release: () => {},
  } as unknown as PoolClient;

  const db = {
    connect: async () => client,
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
  } as unknown as Pool;

  return { db, client, sites, scans, subscriptions };
}

function notifier(): SchedulerNotifier & {
  onCreditSkip: ReturnType<typeof vi.fn>;
} {
  return {
    onCreditSkip: vi.fn(),
  };
}

describe("processDueSites (plan 27: enqueue-only)", () => {
  let state: ReturnType<typeof fakePool>;
  let notify: ReturnType<typeof notifier>;

  beforeEach(() => {
    state = fakePool();
    notify = notifier();
  });

  it("start een scan voor een due site, enqueuett dispatcher en schuift next_scan_at op", async () => {
    const now = new Date("2026-08-15T12:00:00Z");
    state.sites.push(makeSite("site-1"));
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await processDueSites(state.db, { now, enqueue, notify });

    expect(result.due).toBe(1);
    expect(result.started).toEqual(["site-1"]);
    expect(state.scans).toHaveLength(1);
    expect(state.scans[0].trigger).toBe("schedule");
    expect(state.scans[0].scheduled_for?.toISOString()).toBe("2026-08-15T09:00:00.000Z");
    expect(state.scans[0].status).toBe("queued");
    expect(enqueue).toHaveBeenCalledWith(state.scans[0].id);
    expect(state.sites[0].next_scan_at?.toISOString()).toBe("2026-08-16T09:00:00.000Z");
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(1);
    expect(state.sites[0].last_scan_status).toBe("queued");
  });

  it("plant weekly +7 dagen", async () => {
    const now = new Date("2026-08-15T12:00:00Z");
    state.sites.push(makeSite("site-1", { scan_frequency: "weekly" }));

    await processDueSites(state.db, {
      now,
      enqueue: vi.fn().mockResolvedValue(undefined),
      notify,
    });

    expect(state.sites[0].next_scan_at?.toISOString()).toBe("2026-08-22T09:00:00.000Z");
  });

  it("schuift een overlap-site alleen op zonder nieuwe scan of enqueue", async () => {
    state.sites.push(makeSite("site-1"));
    state.scans.push({
      id: "scan-running",
      site_id: "site-1",
      status: "running",
      trigger: "schedule",
      scheduled_for: null,
      created_at: new Date(),
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await processDueSites(state.db, {
      now: new Date("2026-08-15T12:00:00Z"),
      enqueue,
      notify,
    });

    expect(result.started).toEqual([]);
    expect(state.scans).toHaveLength(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(state.sites[0].next_scan_at?.toISOString()).toBe("2026-08-16T09:00:00.000Z");
  });

  it("skippt bij credit-limiet, stuurt mail en houdt het schema actief", async () => {
    state.subscriptions.set("team-1", { credits_used: 5 });
    state.sites.push(makeSite("site-1"));
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await processDueSites(state.db, {
      now: new Date("2026-08-15T12:00:00Z"),
      enqueue,
      notify,
    });

    expect(result.creditSkipped).toEqual(["site-1"]);
    expect(notify.onCreditSkip).toHaveBeenCalledWith({
      teamId: "team-1",
      siteId: "site-1",
      siteName: "site-1.example.com",
    });
    expect(state.scans).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(state.sites[0].next_scan_at?.toISOString()).toBe("2026-08-16T09:00:00.000Z");
  });

  it("enqueuett meerdere due sites en geeft ze allemaal door", async () => {
    state.sites.push(makeSite("site-1"), makeSite("site-2"));
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await processDueSites(state.db, {
      now: new Date("2026-08-15T12:00:00Z"),
      enqueue,
      notify,
    });

    expect(result.started).toEqual(["site-1", "site-2"]);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});