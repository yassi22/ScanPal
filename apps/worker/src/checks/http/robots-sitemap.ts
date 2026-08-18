import {
  checkById,
  evaluateRobotsSitemap,
  inspectRobotsTxt,
  inspectSitemap,
  robotsSitemapEvidence,
  type RobotsSitemapEvidence,
  type SitemapInspection,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/**
 * Feature 36 — robots.txt & sitemap geldigheid/kwaliteit. Fetcht /robots.txt
 * en de sitemap (eerste `Sitemap:`-directive uit robots.txt, anders
 * /sitemap.xml) en produceert één check `robots-sitemap` (category seo).
 * Anders dan de route-discovery (plan 54) gaat het hier om de kwaliteit van
 * de bestanden zelf: aanwezigheid, syntaxis, user-agent-dekking en
 * URL-geldigheid.
 */
export const robotsSitemapCheck: CheckImplementation = {
  id: "robots-sitemap",
  category: "seo",
  async run(ctx) {
    const name = checkById("robots-sitemap")?.name ?? "robots.txt & sitemap";
    const origin = originOf(ctx.url);

    const rate = await ctx.rateLimit(`robots-sitemap:${origin}`, 30, 60);
    if (!rate.ok) {
      return [
        {
          id: "robots-sitemap",
          name,
          status: "warn",
          detail: "Rate-limit bereikt — robots.txt/sitemap niet gecontroleerd",
        },
      ];
    }

    const robotsRes = await fetchPage(`${origin}/robots.txt`, { timeoutMs: 8000 })
      .then(async (res) => ({ res, text: await res.text().catch(() => "") }))
      .catch(() => null);
    const robots = robotsRes
      ? inspectRobotsTxt(robotsRes.text, robotsRes.res.status)
      : inspectRobotsTxt(null, 0);

    // Sitemap: eerste Sitemap:-directive uit robots.txt, anders /sitemap.xml.
    const sitemapUrl =
      robots.sitemapDirectives[0] ?? `${origin}/sitemap.xml`;
    let sitemap: SitemapInspection;
    if (robots.sitemapDirectives.length > 0) {
      try {
        const sitemapRes = await fetchPage(sitemapUrl, { timeoutMs: 8000 });
        const text = await sitemapRes.text().catch(() => "");
        sitemap = inspectSitemap(text, sitemapRes.status, true);
      } catch {
        sitemap = inspectSitemap(null, 0, true);
      }
    } else {
      const sitemapRes = await fetchPage(sitemapUrl, { timeoutMs: 8000 })
        .then(async (res) => ({ res, text: await res.text().catch(() => "") }))
        .catch(() => null);
      sitemap = sitemapRes
        ? inspectSitemap(sitemapRes.text, sitemapRes.res.status, false)
        : inspectSitemap(null, 0, false);
    }

    const { status, issues } = evaluateRobotsSitemap(robots, sitemap);
    const detail =
      status === "pass"
        ? "robots.txt en sitemap aanwezig en geldig"
        : issues.join("; ");
    const evidence: RobotsSitemapEvidence = robotsSitemapEvidence(robots, sitemap);

    return [
      {
        id: "robots-sitemap",
        name,
        status,
        detail,
        evidence,
      },
    ];
  },
};
