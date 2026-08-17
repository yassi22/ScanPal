import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool, QueryResult } from "pg";
import type { FlowProducer } from "bullmq";

vi.mock("@scanpal/scan-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scanpal/scan-core")>();
  return {
    ...actual,
    upsertScanRoutes: vi.fn().mockResolvedValue([]),
  };
});

import { createCrawlProcessor } from "../crawl";
import { upsertScanRoutes } from "@scanpal/scan-core";
import type { RateLimiter } from "../../rate-limit";
import { QUEUES } from "../index";

const mockedUpsertRoutes = vi.mocked(upsertScanRoutes);

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function fakeDb(scan: Row | null) {
  const queries: string[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push(`${sql.replace(/\s+/g, " ").trim()} | ${params.join(",")}`);
      if (sql.includes("from scans sc")) {
        return scan ? { rowCount: 1, rows: [scan] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] } as QueryResultLike;
    },
  } as unknown as Pool;
  return { db, queries };
}

function fakeFlow() {
  const adds: Record<string, unknown>[] = [];
  const flowProducer = {
    add: vi.fn(async (flow: Record<string, unknown>) => {
      adds.push(flow);
    }),
  } as unknown as FlowProducer;
  return { flowProducer, adds };
}

const rateLimit = vi.fn().mockResolvedValue({ ok: true }) as unknown as RateLimiter;

function fetchImpl(_global: typeof globalThis) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/robots.txt")) {
      return new Response(
        ["User-agent: *", "Disallow: /admin", "Sitemap: https://example.com/sitemap.xml", ""].join("\n"),
        { status: 200 },
      );
    }
    if (u.endsWith("/sitemap.xml")) {
      return new Response(
        `<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/blog</loc></url><url><loc>https://example.com/about</loc></url></urlset>`,
        { status: 200 },
      );
    }
    // homepage
    return new Response(
      `<html><script>window.__NEXT_DATA__={"routes":["/contact"]}</script>
       <a href="/pricing">Pricing</a>
       <a href="https://example.com/blog">Blog</a>
       <a href="https://other.com/external">Extern</a>
       </html>`,
      { status: 200 },
    );
  });
}

describe("createCrawlProcessor (plan 54)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchImpl(globalThis));
  });

  it("ontdekt routes uit sitemap/links/SPA, schrijft ze weg en fanned uit", async () => {
    const scan = {
      id: "scan-1",
      status: "queued",
      site_id: "site-1",
      url: "example.com",
      github_repo: null,
      plan: "pro",
    };
    const { db } = fakeDb(scan);
    const { flowProducer, adds } = fakeFlow();

    const processor = createCrawlProcessor(db, flowProducer, rateLimit, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(mockedUpsertRoutes).toHaveBeenCalledTimes(1);
    const [, scanIdArg, routesArg] = mockedUpsertRoutes.mock.calls[0];
    expect(scanIdArg).toBe("scan-1");
    const urls = (routesArg as unknown as { url: string }[]).map((r) => r.url);
    // seed, sitemap (blog, about), spa (contact), link (pricing); external + admin gefilterd
    expect(urls).toContain("https://example.com/");
    expect(urls).toContain("https://example.com/blog");
    expect(urls).toContain("https://example.com/about");
    expect(urls).toContain("https://example.com/contact");
    expect(urls).toContain("https://example.com/pricing");
    expect(urls).not.toContain("https://other.com/external");
    // admin is disallowed → niet in routes
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);

    // fan-out flow aangemaakt
    expect(adds).toHaveLength(1);
    const flow = adds[0] as {
      name: string;
      queueName: string;
      opts: { jobId: string };
      children: { queueName: string }[];
    };
    expect(flow.name).toBe("aggregate");
    expect(flow.queueName).toBe(QUEUES.aggregate);
    expect(flow.opts.jobId).toBe("scan-1");
    expect(flow.children.map((c) => c.queueName)).toEqual([
      QUEUES.http,
      QUEUES.browser,
    ]);
  });

  it("cappt op de plan-limiet en schrijft een info-finding bij overschrijding", async () => {
    // Sitemap met 15 routes → Free-limiet (10) treedt in werking.
    const manyUrls = Array.from({ length: 15 }, (_, i) =>
      `<url><loc>https://example.com/p${i}</loc></url>`,
    ).join("");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow:\n", { status: 200 });
      }
      if (u.endsWith("/sitemap.xml")) {
        return new Response(`<urlset>${manyUrls}</urlset>`, { status: 200 });
      }
      return new Response("<html></html>", { status: 200 });
    }));

    const scan = {
      id: "scan-2",
      status: "queued",
      site_id: "site-2",
      url: "example.com",
      github_repo: null,
      plan: "free", // limiet 10
    };
    const { db, queries } = fakeDb(scan);
    const { flowProducer } = fakeFlow();

    const processor = createCrawlProcessor(db, flowProducer, rateLimit, () => {});
    await processor({ data: { scanId: "scan-2" } });

    // routes gecapt op 10 (free): seed + 9 sitemap-routes
    const routesArg = mockedUpsertRoutes.mock.calls[0][2] as unknown as { url: string }[];
    expect(routesArg.length).toBe(10);
    // info-finding voor de plan-limiet (route-discovery check-rij)
    expect(
      queries.some((q) => q.includes("route-discovery") && q.includes("insert into checks")),
    ).toBe(true);
  });

  it("maakt geen fan-out voor een gecancelde scan", async () => {
    const scan = {
      id: "scan-3",
      status: "canceled",
      site_id: "site-3",
      url: "example.com",
      github_repo: null,
      plan: "pro",
    };
    const { db } = fakeDb(scan);
    const { flowProducer, adds } = fakeFlow();

    const processor = createCrawlProcessor(db, flowProducer, rateLimit, () => {});
    await processor({ data: { scanId: "scan-3" } });

    expect(mockedUpsertRoutes).not.toHaveBeenCalled();
    expect(adds).toHaveLength(0);
  });

  it("voegt een github-child toe bij een gekoppelde repo", async () => {
    const scan = {
      id: "scan-4",
      status: "queued",
      site_id: "site-4",
      url: "example.com",
      github_repo: "https://github.com/acme/site",
      plan: "pro",
    };
    const { db } = fakeDb(scan);
    const { flowProducer, adds } = fakeFlow();

    const processor = createCrawlProcessor(db, flowProducer, rateLimit, () => {});
    await processor({ data: { scanId: "scan-4" } });

    const flow = adds[0] as { children: { queueName: string }[] };
    expect(flow.children.map((c) => c.queueName)).toEqual([
      QUEUES.http,
      QUEUES.browser,
      QUEUES.github,
    ]);
  });
});
