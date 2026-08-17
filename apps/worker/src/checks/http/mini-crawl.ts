import {
  checkById,
  miniCrawlEvidence,
  orphanPagesFromHomeHtml,
  parseSitemap,
  auditImageAlts,
  type InlineCheckLike,
  type MiniCrawlEvidence,
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
 * Feature 38 — mini-crawl check: image-alt audit + orphan-page detectie.
 * Fetcht de homepage (images + interne links) en /sitemap.xml (orphan-
 * vergelijking). Eén check-id `mini-crawl` (category seo). Status: warn als er
 * images zonder alt óf sitemap-orphan-pagina's zijn; pass anders.
 */
export const miniCrawlCheck: CheckImplementation = {
  id: "mini-crawl",
  category: "seo",
  async run(ctx) {
    const name = checkById("mini-crawl")?.name ?? "Interne links & broken links";
    const origin = originOf(ctx.url);

    const rate = await ctx.rateLimit(`mini-crawl:${origin}`, 30, 60);
    if (!rate.ok) {
      return [
        {
          id: "mini-crawl",
          name,
          status: "warn",
          detail: "Rate-limit bereikt — mini-crawl niet uitgevoerd",
        },
      ];
    }

    const [homeResult, sitemapResult] = await Promise.allSettled([
      fetchPage(ctx.url, { timeoutMs: 10000 }),
      fetchPage(`${origin}/sitemap.xml`, { timeoutMs: 8000 }),
    ]);

    if (homeResult.status !== "fulfilled") {
      return [
        {
          id: "mini-crawl",
          name,
          status: "fail",
          detail: "Homepage niet op te halen — mini-crawl niet uitgevoerd",
        },
      ];
    }

    const homeRes = homeResult.value;
    const contentType = homeRes.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return [
        {
          id: "mini-crawl",
          name,
          status: "warn",
          detail: `Geen HTML-pagina (${contentType || "onbekend"}) — mini-crawl niet uitvoerbaar`,
        },
      ];
    }
    const homeHtml = await homeRes.text();

    const imageAudit = auditImageAlts(homeHtml);

    let sitemapRoutes: string[] = [];
    if (sitemapResult.status === "fulfilled") {
      const sitemapText = await sitemapResult.value.text().catch(() => "");
      sitemapRoutes = parseSitemap(sitemapText);
    }

    const orphans = orphanPagesFromHomeHtml(homeHtml, ctx.url, sitemapRoutes);

    const hasIssues = imageAudit.missing > 0 || orphans.orphan_count > 0;
    const status: InlineCheckLike["status"] = hasIssues ? "warn" : "pass";

    const parts: string[] = [];
    if (imageAudit.missing > 0) {
      parts.push(`${imageAudit.missing} van ${imageAudit.total} image(s) zonder alt-attribuut`);
    } else if (imageAudit.total > 0) {
      parts.push(`${imageAudit.total} image(s) met alt`);
    }
    if (sitemapRoutes.length > 0) {
      if (orphans.orphan_count > 0) {
        parts.push(`${orphans.orphan_count} van ${orphans.sitemap_count} sitemap-route(s) niet gelinkt vanaf homepage (orphan-heuristiek)`);
      } else {
        parts.push(`${orphans.sitemap_count} sitemap-route(s) allen gelinkt vanaf homepage`);
      }
    }
    const detail = parts.length > 0
      ? `${parts.join("; ")}.`
      : "Geen images of sitemap-routes gevonden.";

    const evidence: MiniCrawlEvidence = miniCrawlEvidence(imageAudit, orphans);

    return [
      {
        id: "mini-crawl",
        name,
        status,
        detail,
        evidence: hasIssues || imageAudit.total > 0 || sitemapRoutes.length > 0
          ? evidence
          : null,
      },
    ];
  },
};
