import type { Pool } from "pg";
import type { FlowProducer } from "bullmq";
import {
  CRAWL_LIMITS,
  extractInternalLinks,
  extractSpaRoutes,
  findingId,
  isPathDisallowed,
  normalizeRouteUrl,
  parseRobotsTxt,
  parseSitemap,
  routeLimitByPlan,
  type Finding,
  type RouteSource,
} from "@scanpal/shared";
import { upsertScanRoutes, type ScanRouteRow } from "@scanpal/scan-core";
import type { RateLimiter } from "../rate-limit";
import { fetchPage } from "../checks/types";
import { QUEUES, type ScanJobData } from "./index";

type CrawlScanRow = {
  id: string;
  status: string;
  site_id: string;
  url: string;
  github_repo: string | null;
  plan: "free" | "pro" | null;
};

async function loadCrawlScan(
  db: Pool,
  scanId: string,
): Promise<CrawlScanRow | null> {
  const result = await db.query<CrawlScanRow>(
    `select sc.id, sc.status, sc.site_id, s.url, s.github_repo,
            (select sub.plan from subscriptions sub
              where sub.team_id = s.team_id
              order by sub.created_at desc limit 1) as plan
     from scans sc
     join sites s on s.id = sc.site_id
     where sc.id = $1`,
    [scanId],
  );
  return result.rowCount ? result.rows[0] : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Eén fetch met per-host rate-limit + politeness-delay. Retourneert de body
 * (string) en de HTTP-status, of null bij een fout/timeout. Volgt redirects
 * (max `CRAWL_LIMITS.maxRedirects` via fetch-redirect:follow).
 */
async function crawlFetch(
  url: string,
  host: string,
  rateLimit: RateLimiter,
): Promise<{ status: number; body: string } | null> {
  const rate = await rateLimit(`crawl:${host}`, CRAWL_LIMITS.requestsPerHostPerMinute);
  if (!rate.ok) return null;
  try {
    const res = await fetchPage(url, { timeoutMs: CRAWL_LIMITS.fetchTimeoutMs });
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch {
    return null;
  }
}

function planLimit(plan: "free" | "pro" | null): number {
  return routeLimitByPlan[plan ?? "free"];
}

/**
 * Bouwt de info-finding voor de plan-limiet (besluit 3): schrijf een
 * `checks`-rij met check_id `route-discovery` (severity info) zodat deze in de
 * findings-lijst verschijnt. Site-level (geen route_url).
 */
function routeLimitFinding(
  scanId: string,
  limit: number,
  discovered: number,
  now: string,
): { checkId: string; category: string; status: string; severity: string; finding: Finding } {
  const title = `Meer routes beschikbaar op Pro`;
  const finding: Finding = {
    id: findingId("route-discovery", title),
    check_id: "route-discovery",
    category: "seo",
    severity: "info",
    title,
    description: `De crawl ontdekte ${discovered} routes; het Free-plan scant er maximaal ${limit}. Upgrade naar Pro voor tot ${routeLimitByPlan.pro} routes.`,
    remediation: "Upgrade naar Pro om meer routes te scannen.",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    route_url: null,
    created_at: now,
  };
  return {
    checkId: "route-discovery",
    category: "seo",
    status: "info",
    severity: "info",
    finding,
  };
}

async function writeRouteLimitInfo(
  db: Pool,
  scanId: string,
  limit: number,
  discovered: number,
  now: string,
): Promise<void> {
  const entry = routeLimitFinding(scanId, limit, discovered, now);
  await db.query(
    `insert into checks (scan_id, check_id, category, status, severity, finding, completed_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (scan_id, check_id) where route_url is null
     do update set status = excluded.status, severity = excluded.severity,
       finding = excluded.finding, completed_at = now()`,
    [
      scanId,
      entry.checkId,
      entry.category,
      entry.status,
      entry.severity,
      JSON.stringify(entry.finding),
    ],
  );
}

/**
 * Crawler (plan 54, stap 2–4): seed = homepage; bronnen sitemap.xml (parse +
 * valideer), robots.txt (allow-lijst + Sitemap:-directives), interne links
 * (max N), SPA-heuristics. Normalisatie (besluit 3), dedupe, redirect-cap en
 * plan-limiet. Schrijft `scan_routes` + `scans.route_count`, en maakt daarna de
 * fan-out-flow aan (aggregate parent + http/browser/github children) zodat de
 * checks op de volledige route-lijst draaien.
 */
export function createCrawlProcessor(
  db: Pool,
  flowProducer: FlowProducer,
  rateLimit: RateLimiter,
  log: (line: string) => void = () => {},
) {
  return async function crawlProcessor(job: { data: ScanJobData }): Promise<void> {
    const { scanId } = job.data;
    const scan = await loadCrawlScan(db, scanId);
    if (!scan) {
      log(`crawl: scan ${scanId} bestaat niet`);
      return;
    }
    if (scan.status === "canceled") {
      log(`crawl: scan ${scanId} is gecanceld`);
      return;
    }

    const baseUrl = `https://${scan.url}`;
    const host = scan.url;
    const limit = planLimit(scan.plan);

    // 1. robots.txt (Sitemap:-directives + disallow-lijst)
    let disallowedPaths: string[] = [];
    const robotsRes = await crawlFetch(`${baseUrl}/robots.txt`, host, rateLimit);
    let sitemapUrls: string[] = [];
    if (robotsRes && robotsRes.status >= 200 && robotsRes.status < 300) {
      const robots = parseRobotsTxt(robotsRes.body);
      disallowedPaths = robots.disallowedPaths;
      sitemapUrls = robots.sitemaps;
    }

    // 2. sitemap.xml — expliciete Sitemap:-URLs, anders /sitemap.xml
    const sitemapCandidates = sitemapUrls.length > 0
      ? sitemapUrls
      : [`${baseUrl}/sitemap.xml`];
    const sitemapRoutes: string[] = [];
    for (const sitemapUrl of sitemapCandidates) {
      if (sitemapRoutes.length >= CRAWL_LIMITS.maxSitemapUrls) break;
      const sitemapHost = (() => {
        try {
          return new URL(sitemapUrl).hostname;
        } catch {
          return host;
        }
      })();
      const res = await crawlFetch(sitemapUrl, sitemapHost, rateLimit);
      if (res && res.status >= 200 && res.status < 300) {
        sitemapRoutes.push(...parseSitemap(res.body));
      }
      await sleep(CRAWL_LIMITS.hostDelayMs);
    }

    // 3. homepage (seed) — interne links + SPA-heuristics
    const homeRes = await crawlFetch(baseUrl, host, rateLimit);
    const homeHtml = homeRes && homeRes.status >= 200 && homeRes.status < 300 ? homeRes.body : "";
    const homeRoute = normalizeRouteUrl(baseUrl);
    const linkRoutes = homeHtml ? extractInternalLinks(homeHtml, baseUrl) : [];
    const spaRoutes = homeHtml ? extractSpaRoutes(homeHtml, baseUrl) : [];

    // 4. normaliseren + dedupe + robots-filter + plan-limiet
    const ordered: { url: string; source: RouteSource }[] = [];
    const seen = new Set<string>();
    const push = (url: string | null, source: RouteSource) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      ordered.push({ url, source });
    };
    // seed staat voorop
    push(homeRoute, "seed");
    for (const url of sitemapRoutes) push(url, "sitemap");
    for (const url of spaRoutes) push(url, "spa");
    for (const url of linkRoutes) push(url, "link");

    const filtered = ordered.filter((route) => {
      try {
        const path = new URL(route.url).pathname;
        return !isPathDisallowed(path, disallowedPaths);
      } catch {
        return true;
      }
    });

    const discovered = filtered.length;
    const capped = filtered.slice(0, limit);
    const routeRows: ScanRouteRow[] = capped.map((route) => ({
      url: route.url,
      source: route.source,
      http_status: null,
    }));

    await upsertScanRoutes(db, scanId, routeRows);

    if (discovered > limit) {
      await writeRouteLimitInfo(db, scanId, limit, discovered, new Date().toISOString());
    }

    // 5. fan-out (plan 54, besluit 1): pas nu de checks draaien, met de routes
    //    in de DB. Job-names idempotent ({scanId}:{queue}); aggregate parent.
    const includeGithub = Boolean(scan.github_repo);
    const children = [
      {
        name: "http",
        queueName: QUEUES.http,
        opts: { jobId: `${scanId}:http` },
        data: { scanId },
      },
      {
        name: "browser",
        queueName: QUEUES.browser,
        opts: { jobId: `${scanId}:browser` },
        data: { scanId },
      },
      ...(includeGithub
        ? [
            {
              name: "github",
              queueName: QUEUES.github,
              opts: { jobId: `${scanId}:github` },
              data: { scanId },
            },
          ]
        : []),
    ];

    await flowProducer.add({
      name: "aggregate",
      queueName: QUEUES.aggregate,
      opts: { jobId: scanId },
      data: { scanId },
      children,
    });

    log(
      `crawl: scan ${scanId} — ${routeRows.length} route(s) opgeslagen` +
        (discovered > limit ? ` (${discovered} ontdekt, limiet ${limit})` : "") +
        `, fan-out (${children.map((c) => c.queueName).join(", ")})`,
    );
  };
}
