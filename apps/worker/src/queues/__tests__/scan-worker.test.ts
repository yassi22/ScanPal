import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool } from "pg";

vi.mock("@scanpal/scan-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scanpal/scan-core")>();
  return {
    ...actual,
    advanceCategoryProgress: vi.fn(),
    getScanRoutes: vi.fn().mockResolvedValue([]),
    setRouteHttpStatus: vi.fn().mockResolvedValue(undefined),
  };
});

import { createScanProcessor } from "../scan-worker";
import { advanceCategoryProgress, getScanRoutes } from "@scanpal/scan-core";
import type { ImplementedCheck } from "../../checks/registry";
import type { RateLimiter } from "../../rate-limit";
import { fetchPage } from "../../checks/types";

const mockedAdvance = vi.mocked(advanceCategoryProgress);
const mockedGetRoutes = vi.mocked(getScanRoutes);

function fakeResponse(status: number): Response {
  return new Response("", { status });
}

function fakeDb(scan: Record<string, unknown> | null) {
  const queries: string[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push(
        `${sql.replace(/\s+/g, " ").trim()} | ${params.map((p) => String(p)).join(",")}`,
      );
      if (sql.includes("from scans sc")) {
        return scan ? { rowCount: 1, rows: [scan] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  } as unknown as Pool;
  return { db, queries };
}

const rateLimit = { hit: vi.fn().mockResolvedValue(true) } as unknown as RateLimiter;

describe("createScanProcessor (sub-job consumer, plan 54 route-bewust)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(200)));
    mockedGetRoutes.mockResolvedValue([]);
  });

  it("voert een homepage-only check uit, schrijft een checks-rij en schuift progress op", async () => {
    const scan = {
      id: "scan-1",
      status: "running",
      site_url: "example.com",
      active_tests: false,
    };
    const { db, queries } = fakeDb(scan);

    const impl: ImplementedCheck = {
      id: "https",
      category: "http",
      outputCheckIds: ["https"],
      run: vi.fn().mockResolvedValue([
        {
          id: "https",
          name: "HTTPS",
          status: "pass",
          detail: "HTTPS is in orde",
        },
      ]),
    };

    const processor = createScanProcessor(db, [impl], rateLimit);
    await processor({ data: { scanId: "scan-1" } });

    const upsert = queries.find((q) => q.startsWith("insert into checks"));
    expect(upsert).toBeDefined();
    expect(mockedAdvance).toHaveBeenCalledWith(
      db,
      "scan-1",
      "http",
      "https",
      expect.any(String),
    );
  });

  it("draait een per-route check op alle ontdekte routes (route_url op finding)", async () => {
    const scan = {
      id: "scan-2",
      status: "running",
      site_url: "example.com",
      active_tests: false,
    };
    const { db, queries } = fakeDb(scan);
    mockedGetRoutes.mockResolvedValue([
      { url: "https://example.com/", source: "seed", http_status: null },
      { url: "https://example.com/about", source: "link", http_status: null },
      { url: "https://example.com/contact", source: "link", http_status: null },
    ]);

    const impl: ImplementedCheck = {
      id: "meta-tags",
      category: "seo",
      outputCheckIds: ["meta-tags"],
      run: vi.fn().mockImplementation(async (ctx) => [
        {
          id: "meta-tags",
          name: "Meta & OG-tags",
          status: "pass",
          detail: `ok voor ${ctx.url}`,
        },
      ]),
    };

    const processor = createScanProcessor(db, [impl], rateLimit);
    await processor({ data: { scanId: "scan-2" } });

    // één check-run per route
    expect(impl.run).toHaveBeenCalledTimes(3);
    // gebundeld: één insert-statement met alle drie de route_urls
    const upserts = queries.filter((q) => q.startsWith("insert into checks"));
    expect(upserts.length).toBe(1);
    expect(upserts[0]).toContain("https://example.com/about");
    expect(upserts[0]).toContain("https://example.com/contact");
    // progress schuift één keer op (per check_id, niet per route)
    expect(mockedAdvance).toHaveBeenCalledTimes(1);
  });

  it("haalt een route één keer op en deelt die over meerdere per-route checks", async () => {
    const scan = {
      id: "scan-share",
      status: "running",
      site_url: "example.com",
      active_tests: false,
    };
    const { db } = fakeDb(scan);
    mockedGetRoutes.mockResolvedValue([
      { url: "https://example.com/", source: "seed", http_status: null },
    ]);

    // Twee per-route checks die elk de pagina ophalen via ctx.fetchPage
    // (met fallback naar de directe fetchPage voor losse aanroepen).
    const makeFetchingImpl = (id: string): ImplementedCheck => ({
      id,
      category: "http",
      outputCheckIds: [id],
      run: async (ctx) => {
        const doFetch = ctx.fetchPage ?? fetchPage;
        await doFetch(ctx.url, { timeoutMs: 10000 });
        return [{ id, name: id, status: "pass", detail: "ok" }];
      },
    });

    const processor = createScanProcessor(db, [
      makeFetchingImpl("security-headers"),
      makeFetchingImpl("cookies"),
    ], rateLimit);
    await processor({ data: { scanId: "scan-share" } });

    // Eén enkele netwerk-fetch voor de route, gedeeld over probe + beide checks.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("verwerkt routes parallel tot de ingestelde route-concurrency", async () => {
    const scan = {
      id: "scan-par",
      status: "running",
      site_url: "example.com",
      active_tests: false,
    };
    const { db } = fakeDb(scan);
    mockedGetRoutes.mockResolvedValue([
      { url: "https://example.com/", source: "seed", http_status: null },
      { url: "https://example.com/a", source: "link", http_status: null },
      { url: "https://example.com/b", source: "link", http_status: null },
      { url: "https://example.com/c", source: "link", http_status: null },
    ]);

    let active = 0;
    let maxActive = 0;
    const impl: ImplementedCheck = {
      id: "meta-tags",
      category: "seo",
      outputCheckIds: ["meta-tags"],
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return [{ id: "meta-tags", name: "meta", status: "pass", detail: "ok" }];
      },
    };

    const processor = createScanProcessor(db, [impl], rateLimit, {
      routeConcurrency: 2,
    });
    await processor({ data: { scanId: "scan-par" } });

    expect(impl.run).toBeDefined();
    expect(maxActive).toBe(2);
  });

  it("stopt vroeg bij een gecancelde scan", async () => {
    const scan = {
      id: "scan-1",
      status: "canceled",
      site_url: "example.com",
      active_tests: false,
    };
    const { db, queries } = fakeDb(scan);

    const impl: ImplementedCheck = {
      id: "https",
      category: "http",
      outputCheckIds: ["https"],
      run: vi.fn().mockResolvedValue([]),
    };

    const processor = createScanProcessor(db, [impl], rateLimit);
    await processor({ data: { scanId: "scan-1" } });

    expect(impl.run).not.toHaveBeenCalled();
    expect(queries.some((q) => q.startsWith("insert into checks"))).toBe(false);
  });

  it("schrijft een error-finding (route-bewust) als een check faalt", async () => {
    const scan = {
      id: "scan-1",
      status: "running",
      site_url: "example.com",
      active_tests: false,
    };
    const { db, queries } = fakeDb(scan);

    const impl: ImplementedCheck = {
      id: "https",
      category: "http",
      outputCheckIds: ["https"],
      run: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    const processor = createScanProcessor(db, [impl], rateLimit);
    await processor({ data: { scanId: "scan-1" } });

    const upsert = queries.find((q) => q.startsWith("insert into checks"));
    expect(upsert).toBeDefined();
    expect(upsert!.includes("https://example.com")).toBe(true);
    expect(mockedAdvance).toHaveBeenCalledWith(
      db,
      "scan-1",
      "http",
      "https",
      expect.any(String),
    );
  });
});
