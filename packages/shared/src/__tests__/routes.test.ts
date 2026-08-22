import { describe, it, expect } from "vitest";
import {
  CRAWL_LIMITS,
  PER_ROUTE_IMPL_IDS,
  dedupeRoutes,
  detectSpaFramework,
  extractInternalLinks,
  extractSpaRoutes,
  isPathDisallowed,
  normalizeRouteUrl,
  parseRobotsTxt,
  parseSitemap,
  routeLimitByPlan,
  routeSourceSchema,
  scanRouteSchema,
  topRouteUrls,
  type ScanRoute,
} from "../routes";

describe("route-discovery (plan 54)", () => {
  describe("schemas & limieten", () => {
    it("heeft de catalog-bronnen (sitemap|link|spa|seed)", () => {
      expect(routeSourceSchema.options).toEqual(["sitemap", "link", "spa", "seed"]);
    });

    it("scanRouteSchema valideert een route met nullable http_status", () => {
      const route = scanRouteSchema.parse({
        url: "https://example.com/about",
        source: "link",
        http_status: null,
      });
      expect(route.source).toBe("link");
      expect(route.http_status).toBeNull();
    });

    it("plan-limieten: Free 10, Pro 150", () => {
      expect(routeLimitByPlan.free).toBe(10);
      expect(routeLimitByPlan.pro).toBe(150);
    });

    it("PER_ROUTE_IMPL_IDS bevat de per-route checks", () => {
      expect(PER_ROUTE_IMPL_IDS.has("security-headers")).toBe(true);
      expect(PER_ROUTE_IMPL_IDS.has("meta-tags")).toBe(true);
      expect(PER_ROUTE_IMPL_IDS.has("cookies")).toBe(true);
      expect(PER_ROUTE_IMPL_IDS.has("cors")).toBe(true);
      expect(PER_ROUTE_IMPL_IDS.has("reachability")).toBe(false);
      expect(PER_ROUTE_IMPL_IDS.has("secrets-in-bundles")).toBe(false);
    });

    it("CRAWL_LIMITS heeft politeness + anti-loop waarden", () => {
      expect(CRAWL_LIMITS.maxRedirects).toBe(3);
      expect(CRAWL_LIMITS.requestsPerHostPerMinute).toBeGreaterThan(0);
      expect(CRAWL_LIMITS.fetchTimeoutMs).toBeGreaterThan(0);
    });
  });

  describe("normalizeRouteUrl", () => {
    it("stript fragmenten en trailing slash", () => {
      expect(normalizeRouteUrl("https://Example.com/About/#top")).toBe(
        "https://example.com/About",
      );
    });

    it("verwijdert tracking-params en sorteert de rest", () => {
      const url = normalizeRouteUrl("https://example.com/page?utm_source=x&b=2&a=1");
      expect(url).toBe("https://example.com/page?a=1&b=2");
    });

    it("behoudt root", () => {
      expect(normalizeRouteUrl("https://example.com/")).toBe("https://example.com/");
    });

    it("verwerkt relatieve URL's tegen baseUrlHost", () => {
      expect(normalizeRouteUrl("/contact", "example.com")).toBe(
        "https://example.com/contact",
      );
    });

    it("verwerpt cross-site links als baseUrlHost is meegegeven", () => {
      expect(normalizeRouteUrl("https://other.com/x", "example.com")).toBeNull();
    });

    it("verwerpt niet-http(s) schema's", () => {
      expect(normalizeRouteUrl("mailto:info@example.com")).toBeNull();
      expect(normalizeRouteUrl("javascript:alert(1)")).toBeNull();
    });

    it("verwerpt ongeldige input", () => {
      expect(normalizeRouteUrl("")).toBeNull();
      expect(normalizeRouteUrl("::::")).toBeNull();
    });
  });

  describe("dedupeRoutes", () => {
    it("verwijdert duplicaten en nulls, behoudt volgorde", () => {
      expect(
        dedupeRoutes(["https://a.com/1", null, "https://a.com/1", "https://a.com/2"]),
      ).toEqual(["https://a.com/1", "https://a.com/2"]);
    });
  });

  describe("extractInternalLinks", () => {
    it("extraheert same-host links en resolveert relatief", () => {
      const html = `
        <a href="/about">Over ons</a>
        <a href="https://example.com/contact">Contact</a>
        <a href="https://other.com/external">Extern</a>
        <a href="mailto:x@example.com">Mail</a>
        <a href="#anchor">Anchor</a>
      `;
      const links = extractInternalLinks(html, "https://example.com");
      expect(links).toContain("https://example.com/about");
      expect(links).toContain("https://example.com/contact");
      expect(links).not.toContain("https://other.com/external");
      expect(links.every((l) => !l.startsWith("mailto:"))).toBe(true);
    });

    it("dedupet dezelfde link uit meerdere anchors", () => {
      const html = `<a href="/x">1</a><a href="/x">2</a>`;
      expect(extractInternalLinks(html, "https://example.com")).toEqual([
        "https://example.com/x",
      ]);
    });
  });

  describe("parseSitemap", () => {
    it("extraheert <loc>-URL's uit een urlset", () => {
      const xml = `<?xml version="1.0"?>
        <urlset><url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/a</loc></url></urlset>`;
      expect(parseSitemap(xml)).toEqual([
        "https://example.com/",
        "https://example.com/a",
      ]);
    });

    it("volgt een sitemapindex (loc's)", () => {
      const xml = `<sitemapindex><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>`;
      expect(parseSitemap(xml)).toEqual(["https://example.com/sitemap-1.xml"]);
    });
  });

  describe("parseRobotsTxt & isPathDisallowed", () => {
    it("leest Sitemap:-directives en User-agent: * Disallow", () => {
      const robots = [
        "User-agent: *",
        "Disallow: /admin",
        "Disallow: /private/*",
        "Sitemap: https://example.com/sitemap.xml",
        "",
        "User-agent: BadBot",
        "Disallow: /",
      ].join("\n");
      const parsed = parseRobotsTxt(robots);
      expect(parsed.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
      expect(parsed.disallowedPaths).toEqual(["/admin", "/private/*"]);
    });

    it("isPathDisallowed: prefix en wildcard", () => {
      expect(isPathDisallowed("/admin/users", ["/admin"])).toBe(true);
      expect(isPathDisallowed("/private/x", ["/private/*"])).toBe(true);
      expect(isPathDisallowed("/public", ["/admin"])).toBe(false);
      expect(isPathDisallowed("/", ["/"])).toBe(false);
    });

    it("isPathDisallowed: $-eind-anchor (RFC 9309)", () => {
      expect(isPathDisallowed("/page.php", ["/*.php$"])).toBe(true);
      expect(isPathDisallowed("/page.html", ["/*.php$"])).toBe(false);
      expect(isPathDisallowed("/dir/page.php", ["/*.php$"])).toBe(true);
    });
  });

  describe("SPA-heuristiek", () => {
    it("detecteert Next.js via __NEXT_DATA__", () => {
      expect(detectSpaFramework('<script>window.__NEXT_DATA__={}</script>')).toBe(true);
      expect(detectSpaFramework("<html>statische site</html>")).toBe(false);
    });

    it("extraheert route-tokens uit inline SPA-manifest", () => {
      const html = `<script>window.__NEXT_DATA__={"props":{"routes":["/about","/contact"]}}</script>`;
      const routes = extractSpaRoutes(html, "https://example.com");
      expect(routes).toContain("https://example.com/about");
      expect(routes).toContain("https://example.com/contact");
    });

    it("geeft geen routes voor niet-SPA HTML", () => {
      expect(extractSpaRoutes("<html>geen spa</html>", "https://example.com")).toEqual([]);
    });

    it("slaagt geen absolute URLs over (geen //)", () => {
      const html = `<script>__NEXT_DATA__={"x":"//cdn.example.com/foo"}</script>`;
      const routes = extractSpaRoutes(html, "https://example.com");
      expect(routes.some((r) => r.includes("cdn"))).toBe(false);
    });
  });

  describe("topRouteUrls", () => {
    it("seed voorop, dan sitemap, dan links", () => {
      const routes: ScanRoute[] = [
        { url: "https://example.com/contact", source: "link", http_status: null },
        { url: "https://example.com/", source: "seed", http_status: null },
        { url: "https://example.com/blog", source: "sitemap", http_status: null },
        { url: "https://example.com/about", source: "sitemap", http_status: null },
      ];
      expect(topRouteUrls(routes, 3)).toEqual([
        "https://example.com/",
        "https://example.com/blog",
        "https://example.com/about",
      ]);
    });

    it("geeft leeg bij geen routes", () => {
      expect(topRouteUrls([], 5)).toEqual([]);
    });
  });
});
