import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool, QueryResult } from "pg";
import type { Queue } from "bullmq";
import { createDispatcherProcessor } from "../dispatcher";
import { buildRegistry } from "../../checks/registry";
import type { BrowserRunner } from "../../checks/browser/runner";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function fakeDb(scan: Row | null) {
  const queries: string[] = [];
  const db = {
    query: async (sql: string, _params: unknown[] = []) => {
      queries.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("from scans sc")) {
        return scan
          ? { rowCount: 1, rows: [scan] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] } as QueryResultLike;
    },
  } as unknown as Pool;
  return { db, queries };
}

function fakeCrawlQueue() {
  const adds: { name: string; data: unknown; opts: { jobId: string } }[] = [];
  const queue = {
    add: vi.fn(async (name: string, data: unknown, opts: { jobId: string }) => {
      adds.push({ name, data, opts });
    }),
  } as unknown as Queue;
  return { queue, adds };
}

const rateLimit = {} as never;
const cruxDeps = { redis: {}, db: {} } as never;
const mockRunner: BrowserRunner = {
  captureVitals: () => Promise.resolve({ ok: false, error: "mock" }),
  runAxe: () => Promise.resolve({ ok: false, error: "mock" }),
  captureConsole: () => Promise.resolve({ ok: false, error: "mock" }),
  captureResponsive: () => Promise.resolve({ ok: false, error: "mock" }),
  captureRenderCompare: () => Promise.resolve({ ok: false, error: "mock" }),
  captureStorage: () => Promise.resolve({ ok: false, error: "mock" }),
  captureClientDeps: () => Promise.resolve({ ok: false, error: "mock" }),
  captureAuthFlow: () => Promise.resolve({ ok: false, error: "mock" }),
};
const registry = buildRegistry(rateLimit, mockRunner, cruxDeps);

describe("createDispatcherProcessor (plan 54)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schrijft het skelet en enqueuet scan.crawl voor een queued scan", async () => {
    const scan = {
      id: "scan-1",
      status: "queued",
      site_id: "site-1",
      url: "example.com",
      github_repo: null,
      active_tests: false,
    };
    const { db, queries } = fakeDb(scan);
    const { queue, adds } = fakeCrawlQueue();

    const processor = createDispatcherProcessor(db, queue, registry, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(queries.some((q) => q.startsWith("update scans set status"))).toBe(true);
    expect(adds).toHaveLength(1);
    expect(adds[0].name).toBe("crawl");
    expect(adds[0].data).toEqual({ scanId: "scan-1" });
    expect(adds[0].opts.jobId).toBe("scan-1");
  });

  it("enqueuet geen crawl voor een gecancelde scan", async () => {
    const scan = {
      id: "scan-3",
      status: "canceled",
      site_id: "site-3",
      url: "example.com",
      github_repo: null,
      active_tests: false,
    };
    const { db } = fakeDb(scan);
    const { queue, adds } = fakeCrawlQueue();

    const processor = createDispatcherProcessor(db, queue, registry, () => {});
    await processor({ data: { scanId: "scan-3" } });

    expect(adds).toHaveLength(0);
  });

  it("enqueuet geen crawl als de scan ontbreekt", async () => {
    const { db } = fakeDb(null);
    const { queue, adds } = fakeCrawlQueue();

    const processor = createDispatcherProcessor(db, queue, registry, () => {});
    await processor({ data: { scanId: "scan-404" } });

    expect(adds).toHaveLength(0);
  });
});
