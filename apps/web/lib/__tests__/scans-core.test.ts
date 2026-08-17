import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { ProgressDetails } from "@scanpal/shared";
import {
  createManualScan,
  listScanHistory,
  setSiteSchedule,
  getPreviousScanScore,
  getScanTrend,
  cancelScan,
  finishScan,
  ScanError,
  CancelScanError,
  type ScanRowWithMeta,
} from "../../lib/scans-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({ notifier: vi.fn() }));
vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function makeProgressDetails(): ProgressDetails {
  const emptyCategory = {
    status: "pending",
    done: 0,
    total: 0,
    percent: 0,
    current_check: null,
  } as const;
  return {
    categories: {
      http: emptyCategory,
      seo: emptyCategory,
      aeo: emptyCategory,
      github: emptyCategory,
      compliance: emptyCategory,
    },
    checks_done: 0,
    checks_total: 0,
    updated_at: new Date().toISOString(),
  };
}

function makeScan(
  id: string,
  siteId: string,
  overrides: Partial<ScanRowWithMeta> = {},
): ScanRowWithMeta {
  return {
    id,
    site_id: siteId,
    status: "queued",
    progress: 0,
    progress_details: makeProgressDetails(),
    score: null,
    findings: {},
    diff: {},
    category_scores: null,
    active_tests: false,
    trigger: "manual",
    scheduled_for: null,
    created_at: new Date("2026-08-15T09:00:00Z"),
    completed_at: null,
    ...overrides,
  };
}

type FakeSite = {
  id: string;
  team_id: string;
  url: string;
  scan_frequency: string;
  next_scan_at: Date | null;
  last_scan_status: string | null;
  last_scan_score: number | null;
};

type FakeTransaction = {
  team_id: string;
  amount: number;
  reason: string;
  scan_id: string | null;
};

function fakePool() {
  let scanSeq = 0;
  const sites: FakeSite[] = [];
  const scans: ScanRowWithMeta[] = [];
  const subscriptions = new Map<string, { credits_used: number }>();
  const transactions: FakeTransaction[] = [];
  let snapshot: {
    sites: FakeSite[];
    scans: ScanRowWithMeta[];
    subscriptions: Map<string, { credits_used: number }>;
  } | null = null;

  function handle(sql: string, params: unknown[] = []): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();
    const [a, b] = params as [string, string];

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

    if (text.startsWith("select status from scans")) {
      const scan = scans.find((sc) => sc.id === a);
      return scan
        ? { rowCount: 1, rows: [{ status: scan.status }] }
        : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("select * from scans")) {
      const scan = scans.find((sc) => sc.id === a);
      return scan ? { rowCount: 1, rows: [{ ...scan }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("select s.id, s.site_id, s.status from scans s")) {
      const scan = scans.find((sc) => sc.id === a);
      const site = scan ? sites.find((s) => s.id === scan.site_id) : undefined;
      if (!scan || !site || site.team_id !== b) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{ id: scan.id, site_id: scan.site_id, status: scan.status }],
      };
    }

    if (text.startsWith("update scans set status = 'canceled'")) {
      const scan = scans.find((sc) => sc.id === a);
      if (!scan) return { rowCount: 0, rows: [] };
      scan.status = "canceled";
      return { rowCount: 1, rows: [{ ...scan }] };
    }

    if (text.startsWith("select url from sites")) {
      const site = sites.find((s) => s.id === a && s.team_id === b);
      return site ? { rowCount: 1, rows: [{ url: site.url }] } : { rowCount: 0, rows: [] };
    }

    if (text.includes("status in ('queued', 'running')")) {
      const active = scans.some(
        (sc) => sc.site_id === a && (sc.status === "queued" || sc.status === "running"),
      );
      return active ? { rowCount: 1, rows: [{ 1: 1 }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("insert into scans")) {
      const [siteId, trigger, activeTests] = params as [
        string,
        "manual" | "deploy",
        boolean,
      ];
      const scan = makeScan(`scan-${++scanSeq}`, siteId, {
        trigger,
        status: "queued",
        active_tests: activeTests,
      });
      scans.push(scan);
      return { rowCount: 1, rows: [{ ...scan }] };
    }

    if (text.startsWith("select findings from scans")) {
      const previous = scans
        .filter(
          (sc) =>
            sc.site_id === a &&
            sc.id !== b &&
            sc.status === "completed" &&
            sc.findings &&
            Object.keys(sc.findings).length > 0,
        )
        .sort((x, y) => y.created_at.getTime() - x.created_at.getTime());
      const row = previous[0];
      return row ? { rowCount: 1, rows: [{ findings: row.findings }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("update scans set progress")) {
      const [scanId, progress, detailsJson] = params as [
        string,
        number,
        string,
      ];
      const scan = scans.find((sc) => sc.id === scanId);
      if (!scan) return { rowCount: 0, rows: [] };
      scan.progress = progress;
      scan.progress_details = JSON.parse(detailsJson ?? "{}") as ProgressDetails;
      return { rowCount: 1, rows: [{ ...scan }] };
    }

    if (text.startsWith("update scans set status")) {
      const [scanId, status, score, findingsJson, categoryScoresJson] = params as [
        string,
        string,
        number | null,
        string,
        string | null,
      ];
      const scan = scans.find((sc) => sc.id === scanId);
      if (!scan) return { rowCount: 0, rows: [] };
      scan.status = status as ScanRowWithMeta["status"];
      scan.progress = 100;
      scan.score = score ?? null;
      scan.findings = JSON.parse(findingsJson ?? "{}");
      scan.category_scores = categoryScoresJson ? JSON.parse(categoryScoresJson) : null;
      scan.completed_at = new Date();
      return { rowCount: 1, rows: [{ ...scan }] };
    }

    if (text.startsWith("update sites set last_scan_id")) {
      const site = sites.find((s) => s.id === params[3]);
      if (site) {
        site.last_scan_status = params[1] as string;
        site.last_scan_score = (params[2] as number | null) ?? site.last_scan_score;
      }
      return { rowCount: site ? 1 : 0, rows: [] };
    }

    if (text.startsWith("update sites set scan_frequency")) {
      const [frequency, next, siteId, teamId] = params as [
        string,
        Date | null,
        string,
        string,
      ];
      const site = sites.find((s) => s.id === siteId && s.team_id === teamId);
      if (!site) return { rowCount: 0, rows: [] };
      site.scan_frequency = frequency;
      site.next_scan_at = next;
      return {
        rowCount: 1,
        rows: [{ id: site.id, scan_frequency: site.scan_frequency, next_scan_at: site.next_scan_at }],
      };
    }

    if (text.startsWith("select sc.id")) {
      const rows = scans
        .filter((sc) => sites.some((s) => s.id === sc.site_id && s.team_id === a))
        .filter((sc) => (b ? sc.site_id === b : true))
        .map((sc) => {
          const site = sites.find((s) => s.id === sc.site_id)!;
          return {
            id: sc.id,
            site_id: sc.site_id,
            site_url: site.url,
            site_label: null,
            status: sc.status,
            progress: sc.progress,
            score: sc.score,
            trigger: sc.trigger,
            scheduled_for: sc.scheduled_for,
            created_at: sc.created_at,
            completed_at: sc.completed_at,
          };
        });
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("select score from scans")) {
      const completed = scans
        .filter((sc) => sc.site_id === a && sc.status === "completed" && sc.score !== null)
        .sort((x, y) => y.created_at.getTime() - x.created_at.getTime());
      const row = completed[0];
      return row ? { rowCount: 1, rows: [{ score: row.score }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("select 1 from subscriptions")) {
      const sub = subscriptions.get(a);
      return sub ? { rowCount: 1, rows: [{ 1: 1 }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("select id, url, github_repo, label, public_status_slug")) {
      const site = sites.find((s) => s.id === a && s.team_id === b);
      return site
        ? {
            rowCount: 1,
            rows: [
              {
                id: site.id,
                url: site.url,
                github_repo: null,
                github_webhook_configured: false,
                label: null,
                public_status_slug: null,
                last_scan_score: site.last_scan_score,
                last_scanned_at: null,
              },
            ],
          }
        : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("select id, status, score, category_scores, trigger, created_at, completed_at from scans")) {
      const [siteId, limit] = params as [string, number];
      const rows = scans
        .filter(
          (sc) =>
            sc.site_id === siteId &&
            (sc.status === "completed" || sc.status === "failed"),
        )
        .sort((x, y) => x.created_at.getTime() - y.created_at.getTime())
        .slice(0, limit)
        .map((sc) => ({
          id: sc.id,
          status: sc.status,
          score: sc.score,
          category_scores: sc.category_scores ?? null,
          trigger: sc.trigger,
          created_at: sc.created_at,
          completed_at: sc.completed_at,
        }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("insert into subscriptions")) {
      if (!subscriptions.has(a)) {
        subscriptions.set(a, { credits_used: 0 });
      }
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("update subscriptions set credits_used = credits_used + 1")) {
      const sub = subscriptions.get(a);
      const limit = params[1] as number;
      if (!sub || sub.credits_used >= limit) return { rowCount: 0, rows: [] };
      sub.credits_used += 1;
      return { rowCount: 1, rows: [{ credits_used: sub.credits_used }] };
    }

    if (text.startsWith("update subscriptions set credits_used = greatest")) {
      const sub = subscriptions.get(a);
      if (sub) sub.credits_used = Math.max(sub.credits_used - 1, 0);
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    if (text.startsWith("update subscriptions set credits_used = 0")) {
      const sub = subscriptions.get(a);
      if (sub) sub.credits_used = 0;
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    if (text.startsWith("insert into credit_transactions")) {
      const amountMatch = /values \(\$1, (-?\d+)/.exec(text);
      const amount = amountMatch ? Number(amountMatch[1]) : 1;
      const literalReason = /'([a-z_]+)'/.exec(text);
      const reason = literalReason
        ? literalReason[1]
        : (params[1] as string);
      const scanId = literalReason
        ? (params[1] as string | null)
        : ((params[2] as string | null) ?? null);
      transactions.push({
        team_id: params[0] as string,
        amount,
        reason,
        scan_id: scanId ?? null,
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select 1 from credit_transactions")) {
      const scanId = params[1] as string;
      const spent = transactions.some(
        (t) => t.team_id === a && t.scan_id === scanId && t.amount === 1,
      );
      const refunded = transactions.some(
        (t) =>
          t.team_id === a &&
          t.scan_id === scanId &&
          t.amount === -1 &&
          t.reason === "scan_cancel",
      );
      return spent && !refunded
        ? { rowCount: 1, rows: [{ 1: 1 }] }
        : { rowCount: 0, rows: [] };
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

  return { db, client, sites, scans, subscriptions, transactions };
}

describe("createManualScan (plan 27: queue-only)", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push({
      id: "site-1",
      team_id: "team-1",
      url: "example.com",
      scan_frequency: "none",
      next_scan_at: null,
      last_scan_status: null,
      last_scan_score: null,
    });
  });

  it("legt een queued scan aan, boekt een credit en zet de site-status", async () => {
    const { scan, completed } = await createManualScan(state.db, {
      teamId: "team-1",
      siteId: "site-1",
    });

    expect(completed).toBe(false);
    expect(scan.status).toBe("queued");
    expect(scan.trigger).toBe("manual");
    expect(scan.progress).toBe(0);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(1);
    expect(state.sites[0].last_scan_status).toBe("queued");
  });

  it("slaat de actieve-tests-vlag op de scan op", async () => {
    const { scan } = await createManualScan(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      activeTests: true,
    });

    expect(scan.active_tests).toBe(true);
  });

  it("geeft not_found voor een site van een ander team", async () => {
    await expect(
      createManualScan(state.db, {
        teamId: "team-2",
        siteId: "site-1",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(state.scans).toHaveLength(0);
  });

  it("weigert een tweede scan als er al een actieve loopt", async () => {
    state.scans.push(makeScan("scan-active", "site-1", { status: "running" }));

    await expect(
      createManualScan(state.db, {
        teamId: "team-1",
        siteId: "site-1",
      }),
    ).rejects.toMatchObject({ code: "overlap" });
    expect(state.scans).toHaveLength(1);
  });

  it("blokkeert bij credit-limiet zonder scan te maken", async () => {
    state.subscriptions.set("team-1", { credits_used: 5 });

    await expect(
      createManualScan(state.db, {
        teamId: "team-1",
        siteId: "site-1",
      }),
    ).rejects.toThrow(/limiet/i);
    expect(state.scans).toHaveLength(0);
  });
});

describe("listScanHistory", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push(
      { id: "site-1", team_id: "team-1", url: "a.example.com", scan_frequency: "none", next_scan_at: null, last_scan_status: null, last_scan_score: null },
      { id: "site-2", team_id: "team-1", url: "b.example.com", scan_frequency: "none", next_scan_at: null, last_scan_status: null, last_scan_score: null },
      { id: "site-3", team_id: "team-2", url: "c.example.com", scan_frequency: "none", next_scan_at: null, last_scan_status: null, last_scan_score: null },
    );
    state.scans.push(
      makeScan("scan-1", "site-1", { status: "completed", score: 80, created_at: new Date("2026-08-15T09:00:00Z") }),
      makeScan("scan-2", "site-1", { status: "failed", created_at: new Date("2026-08-14T09:00:00Z") }),
      makeScan("scan-3", "site-2", { status: "completed", score: 90, created_at: new Date("2026-08-13T09:00:00Z") }),
      makeScan("scan-4", "site-3", { status: "completed", score: 50, created_at: new Date("2026-08-12T09:00:00Z") }),
    );
  });

  it("geeft alleen scans van het eigen team terug", async () => {
    const rows = await listScanHistory(state.db, { teamId: "team-1" });
    expect(rows.map((r) => r.id)).toEqual(["scan-1", "scan-2", "scan-3"]);
    expect(rows[0].site_url).toBe("a.example.com");
  });

  it("filtert op site binnen het team", async () => {
    const rows = await listScanHistory(state.db, { teamId: "team-1", siteId: "site-2" });
    expect(rows.map((r) => r.id)).toEqual(["scan-3"]);
  });
});

describe("setSiteSchedule", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push({
      id: "site-1",
      team_id: "team-1",
      url: "example.com",
      scan_frequency: "none",
      next_scan_at: null,
      last_scan_status: null,
      last_scan_score: null,
    });
  });

  it("zet next_scan_at op de eerstvolgende 09:00 UTC bij daily", async () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const schedule = await setSiteSchedule(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      frequency: "daily",
      now,
    });

    expect(schedule.scan_frequency).toBe("daily");
    expect(schedule.next_scan_at?.toISOString()).toBe("2026-08-16T09:00:00.000Z");
  });

  it("wist next_scan_at bij none", async () => {
    state.sites[0].scan_frequency = "weekly";
    state.sites[0].next_scan_at = new Date("2026-08-20T09:00:00Z");

    const schedule = await setSiteSchedule(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      frequency: "none",
    });

    expect(schedule.scan_frequency).toBe("none");
    expect(schedule.next_scan_at).toBeNull();
  });

  it("geeft not_found voor een site van een ander team", async () => {
    await expect(
      setSiteSchedule(state.db, {
        teamId: "team-2",
        siteId: "site-1",
        frequency: "daily",
      }),
    ).rejects.toBeInstanceOf(ScanError);
  });
});

describe("getPreviousScanScore", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push({
      id: "site-1",
      team_id: "team-1",
      url: "example.com",
      scan_frequency: "none",
      next_scan_at: null,
      last_scan_status: null,
      last_scan_score: null,
    });
  });

  it("geeft de score van de laatste voltooide scan", async () => {
    state.scans.push(
      makeScan("scan-old", "site-1", { status: "completed", score: 41, created_at: new Date("2026-08-10T09:00:00Z") }),
      makeScan("scan-new", "site-1", { status: "completed", score: 88, created_at: new Date("2026-08-14T09:00:00Z") }),
    );

    expect(await getPreviousScanScore(state.client, "site-1")).toBe(88);
  });

  it("geeft null als er geen voltooide scan is", async () => {
    expect(await getPreviousScanScore(state.client, "site-1")).toBeNull();
  });
});

describe("cancelScan", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push({
      id: "site-1",
      team_id: "team-1",
      url: "example.com",
      scan_frequency: "none",
      next_scan_at: null,
      last_scan_status: null,
      last_scan_score: null,
    });
    state.subscriptions.set("team-1", { credits_used: 1 });
    state.transactions.push({
      team_id: "team-1",
      amount: 1,
      reason: "scan",
      scan_id: "scan-1",
    });
  });

  it("cancelt een queued scan, werkt de site-status bij en refundt de credit", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "queued" }));

    const scan = await cancelScan(state.db, {
      teamId: "team-1",
      scanId: "scan-1",
    });

    expect(scan.status).toBe("canceled");
    expect(scan.completed_at).toBeNull();
    expect(state.sites[0].last_scan_status).toBe("canceled");
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(0);
    expect(state.transactions).toEqual([
      { team_id: "team-1", amount: 1, reason: "scan", scan_id: "scan-1" },
      {
        team_id: "team-1",
        amount: -1,
        reason: "scan_cancel",
        scan_id: "scan-1",
      },
    ]);
  });

  it("cancelt een running scan en behoudt de score van de site", async () => {
    state.scans.push(
      makeScan("scan-1", "site-1", { status: "running", progress: 45 }),
    );
    state.sites[0].last_scan_score = 83;

    await cancelScan(state.db, { teamId: "team-1", scanId: "scan-1" });

    expect(state.sites[0].last_scan_status).toBe("canceled");
    expect(state.sites[0].last_scan_score).toBe(83);
  });

  it("weigert een terminale scan met not_cancelable", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "completed" }));

    await expect(
      cancelScan(state.db, { teamId: "team-1", scanId: "scan-1" }),
    ).rejects.toBeInstanceOf(CancelScanError);
    await expect(
      cancelScan(state.db, { teamId: "team-1", scanId: "scan-1" }),
    ).rejects.toMatchObject({ code: "not_cancelable" });
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(1);
  });

  it("weigert een dubbele cancel en refundt geen tweede keer", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "running" }));

    await cancelScan(state.db, { teamId: "team-1", scanId: "scan-1" });
    await expect(
      cancelScan(state.db, { teamId: "team-1", scanId: "scan-1" }),
    ).rejects.toMatchObject({ code: "not_cancelable" });

    const refunds = state.transactions.filter((t) => t.amount === -1);
    expect(refunds).toHaveLength(1);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(0);
  });

  it("geeft not_found voor een scan van een ander team", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "running" }));

    await expect(
      cancelScan(state.db, { teamId: "team-2", scanId: "scan-1" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(state.scans[0].status).toBe("running");
  });

  it("maakt de site vrij voor een nieuwe scan na cancel (overlap telt niet)", async () => {
    state.scans.push(makeScan("scan-old", "site-1", { status: "queued" }));
    await cancelScan(state.db, { teamId: "team-1", scanId: "scan-old" });

    const { scan, completed } = await createManualScan(state.db, {
      teamId: "team-1",
      siteId: "site-1",
    });

    expect(completed).toBe(false);
    expect(scan.status).toBe("queued");
    expect(state.scans).toHaveLength(2);
  });

  it("is idempotent voor refund als er geen spend was (bijv. gratis flow)", async () => {
    state.transactions = [];
    state.subscriptions.set("team-1", { credits_used: 0 });
    state.scans.push(makeScan("scan-1", "site-1", { status: "queued" }));

    await cancelScan(state.db, { teamId: "team-1", scanId: "scan-1" });

    expect(state.subscriptions.get("team-1")?.credits_used).toBe(0);
    expect(state.transactions).toHaveLength(0);
  });
});

describe("finishScan guard", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push({
      id: "site-1",
      team_id: "team-1",
      url: "example.com",
      scan_frequency: "none",
      next_scan_at: null,
      last_scan_status: null,
      last_scan_score: null,
    });
  });

  it("overschrijft een gecancelde scan nooit naar completed", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "canceled" }));
    state.sites[0].last_scan_status = "canceled";
    state.sites[0].last_scan_score = 83;

    const scan = await finishScan(state.db, {
      scanId: "scan-1",
      siteId: "site-1",
      status: "completed",
      score: 75,
      findings: { checks: [] },
    });

    expect(scan.status).toBe("canceled");
    expect(scan.completed_at).toBeNull();
    expect(scan.score).toBeNull();
    expect(state.sites[0].last_scan_status).toBe("canceled");
    expect(state.sites[0].last_scan_score).toBe(83);
  });

  it("overschrijft een gecancelde scan nooit naar failed", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "canceled" }));
    state.sites[0].last_scan_status = "canceled";

    await finishScan(state.db, {
      scanId: "scan-1",
      siteId: "site-1",
      status: "failed",
      findings: { error: "netwerkfout" },
    });

    expect(state.scans[0].status).toBe("canceled");
    expect(state.sites[0].last_scan_status).toBe("canceled");
  });

  it("laat een normaal finish-pad intact (niet-canceled)", async () => {
    state.scans.push(makeScan("scan-1", "site-1", { status: "running" }));
    state.sites[0].last_scan_status = "running";

    const scan = await finishScan(state.db, {
      scanId: "scan-1",
      siteId: "site-1",
      status: "completed",
      score: 66,
      findings: { checks: [] },
    });

    expect(scan.status).toBe("completed");
    expect(scan.score).toBe(66);
    expect(state.sites[0].last_scan_status).toBe("completed");
  });
});

describe("getScanTrend (feature 10)", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
    state.sites.push(
      { id: "site-1", team_id: "team-1", url: "a.example.com", scan_frequency: "none", next_scan_at: null, last_scan_status: "completed", last_scan_score: 70 },
      { id: "site-2", team_id: "team-2", url: "b.example.com", scan_frequency: "none", next_scan_at: null, last_scan_status: "completed", last_scan_score: 30 },
    );
    state.scans.push(
      makeScan("scan-1", "site-1", {
        status: "completed",
        score: 40,
        category_scores: { http: 50, seo: null, aeo: null, github: null },
        created_at: new Date("2026-08-10T09:00:00Z"),
        completed_at: new Date("2026-08-10T09:01:00Z"),
      }),
      makeScan("scan-2", "site-1", {
        status: "failed",
        score: null,
        category_scores: null,
        created_at: new Date("2026-08-12T09:00:00Z"),
        completed_at: new Date("2026-08-12T09:01:00Z"),
      }),
      makeScan("scan-3", "site-1", {
        status: "completed",
        score: 70,
        category_scores: { http: 80, seo: 60, aeo: null, github: null },
        created_at: new Date("2026-08-14T09:00:00Z"),
        completed_at: new Date("2026-08-14T09:01:00Z"),
      }),
      makeScan("scan-running", "site-1", {
        status: "running",
        progress: 30,
        created_at: new Date("2026-08-15T09:00:00Z"),
      }),
      makeScan("scan-other", "site-2", {
        status: "completed",
        score: 30,
        created_at: new Date("2026-08-09T09:00:00Z"),
      }),
    );
  });

  it("geeft site + voltooide/failed scans in chronologische volgorde", async () => {
    const { site, points } = await getScanTrend(state.db, {
      teamId: "team-1",
      siteId: "site-1",
    });

    expect(site?.id).toBe("site-1");
    expect(site?.url).toBe("a.example.com");
    expect(site?.last_scan_score).toBe(70);
    // running scan valt weg; alleen completed/failed, oud → nieuw
    expect(points.map((p) => p.id)).toEqual(["scan-1", "scan-2", "scan-3"]);
    expect(points.map((p) => p.score)).toEqual([40, null, 70]);
  });

  it("bewaart de per-categorie-scores per punt", async () => {
    const { points } = await getScanTrend(state.db, {
      teamId: "team-1",
      siteId: "site-1",
    });

    expect(points[0].category_scores?.http).toBe(50);
    expect(points[1].category_scores).toBeNull();
    expect(points[2].category_scores?.seo).toBe(60);
  });

  it("leakt geen site van een ander team (site null, points leeg)", async () => {
    const { site, points } = await getScanTrend(state.db, {
      teamId: "team-1",
      siteId: "site-2",
    });

    expect(site).toBeNull();
    expect(points).toHaveLength(0);
  });

  it("cappt de limit op max 100 en respecteert de volgorde", async () => {
    for (let i = 0; i < 110; i++) {
      state.scans.push(
        makeScan(`bulk-${i}`, "site-1", {
          status: "completed",
          score: 50,
          created_at: new Date(2026, 7, 1, 0, i),
        }),
      );
    }

    const { points } = await getScanTrend(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      limit: 200,
    });

    expect(points).toHaveLength(100);
  });
});
