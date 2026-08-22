import { z } from "zod";

/**
 * Route-discovery + per-route checks (plan 54). Pure helpers (geen netwerk,
 * geen DB) gedeeld door de crawler (worker) en de API/UI. Netwerk- en
 * DB-logica woont in de crawler-processor (`apps/worker/src/queues/crawl.ts`)
 * en `packages/scan-core`.
 */

/** Bron waaruit een route is ontdekt (besluit 2). */
export const routeSourceSchema = z.enum(["sitemap", "link", "spa", "seed"]);
export type RouteSource = z.infer<typeof routeSourceSchema>;

export const routeSourceLabels: Record<RouteSource, string> = {
  sitemap: "Sitemap",
  link: "Interne link",
  spa: "SPA-manifest",
  seed: "Homepage",
};

/** Eén ontdekte route (besluit 2). `http_status` wordt in de check-fase gezet. */
export const scanRouteSchema = z.object({
  url: z.string().url(),
  source: routeSourceSchema,
  http_status: z.number().int().nullable().default(null),
});
export type ScanRoute = z.infer<typeof scanRouteSchema>;

/** Plan-limieten voor routes (besluit 3; feature-flag `routes`). */
export const routeLimitByPlan: Record<"free" | "pro", number> = {
  free: 10,
  pro: 150,
};

/** Crawl-gedrag (besluit 6): politeness + anti-loop. */
export const CRAWL_LIMITS = {
  /** Max interne links die per pagina worden gevolgd. */
  maxLinksPerPage: 50,
  /** Max sitemap-URL's die worden overgenomen. */
  maxSitemapUrls: 200,
  /** Redirects die worden gevolgd per route (anti-loop). */
  maxRedirects: 3,
  /** Per-request timeout (sitemap/robots/pagina). */
  fetchTimeoutMs: 10_000,
  /** Per-host Redis rate-limit (verplicht uit AGENTS.md). */
  requestsPerHostPerMinute: 60,
  /** Minimale pauze tussen requests naar dezelfde host (ms). */
  hostDelayMs: 500,
} as const;

/**
 * Check-implementaties die op élke ontdekte route draaien (besluit 4: per-route
 * subset = security-headers, secrets-in-html, meta-tags, structured-data; hier
 * vertaald naar de geïmplementeerde impl-ids). Andere http-impls (reachability,
 * https, secrets-in-bundles, active-tests) draaien alleen op de seed/homepage
 * (kosten / origin-level). Browser (CWV/axe) op top-routes — lege queue vandaag.
 */
export const PER_ROUTE_IMPL_IDS: ReadonlySet<string> = new Set([
  "security-headers",
  "cookies",
  "cors",
  "meta-tags",
]);

/** Tracking-params die bij normalisatie worden gestript (besluit 3). */
const STRIPPED_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "ref",
]);

/**
 * Normaliseert een URL tot een stabiele route-key (besluit 3): lowercase host,
 * geen fragment, query-params gesorteerd met tracking-params verwijderd,
 * trailing slash van het pad verwijderd (behalve root). Cross-site links worden
 * verworpen (return null) wanneer `baseUrlHost` wordt meegegeven.
 */
export function normalizeRouteUrl(
  raw: string,
  baseUrlHost?: string,
): string | null {
  if (!raw || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Geen absolute URL — probeer als relatieve referentie tegen de base-host.
    // Een input met ':' die niet als absolute URL parseert (zoals '::::') is
    // geen geldige relatieve referentie en wordt verworpen.
    if (raw.includes(":")) return null;
    try {
      url = new URL(raw, `https://${baseUrlHost ?? "example.com"}`);
    } catch {
      return null;
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (baseUrlHost && url.hostname !== baseUrlHost) return null;
  if (url.username || url.password) return null;

  let path = url.pathname.replace(/\/+/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "") path = "/";

  const params = new URLSearchParams(url.searchParams);
  for (const key of [...params.keys()]) {
    if (STRIPPED_QUERY_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  params.sort();
  const query = params.toString();

  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${path}${query ? `?${query}` : ""}`;
}

/** Verwijdert duplicaten en ongeldige URL's, behoudt volgorde (eerste wint). */
export function dedupeRoutes(urls: (string | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

/**
 * Extraheert interne `<a href>`-links uit HTML, ge-resolved tegen `baseUrl`
 * (besluit: link-crawl is de stabiele ruggegraat van route-ontdekking). Mailto,
 * tel, javascript en anchors worden overgeslagen; alleen same-host http(s).
 */
export function extractInternalLinks(
  html: string,
  baseUrl: string,
): string[] {
  let baseHost: string | undefined;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    baseHost = undefined;
  }
  const urls: (string | null)[] = [];
  const re = /<a[^>]*\bhref=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|data:|#)/i.test(href)) continue;
    urls.push(normalizeRouteUrl(href, baseHost));
  }
  return dedupeRoutes(urls);
}

/** Parseert een sitemap.xml-body (urlset én sitemapindex): alle `<loc>`-URL's. */
export function parseSitemap(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const url = normalizeRouteUrl(match[1].trim());
    if (url) urls.push(url);
  }
  return urls.slice(0, CRAWL_LIMITS.maxSitemapUrls);
}

export type RobotsParseResult = {
  sitemaps: string[];
  /** Disallow-paden uit de `User-agent: *`-groep (gefilterd tijdens link-crawl). */
  disallowedPaths: string[];
};

/**
 * Statische parse van robots.txt (besluit 2): Sitemap:-directives en de
 * Disallow-paden voor `User-agent: *`. Wordt niet zelf uitgevoerd (geen robots-
 * engine) — disallowed-paden worden als filter gebruikt voor de link-crawl.
 */
export function parseRobotsTxt(robots: string): RobotsParseResult {
  const sitemaps: string[] = [];
  const disallowedPaths: string[] = [];
  const lines = robots.split(/\r?\n/);
  let appliesToAll = true;
  let inGroup = false;
  for (const line of lines) {
    const trimmed = line.split("#")[0].trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const field = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (inGroup && appliesToAll && disallowedPaths.length === 0 && sitemaps.length === 0) {
        // meerdere user-agent-regels in één groep — geldt nog steeds voor *
      }
      inGroup = true;
      appliesToAll = value === "*";
      continue;
    }
    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (field === "disallow" && appliesToAll && value) {
      disallowedPaths.push(value);
      continue;
    }
    if (field === "allow" && appliesToAll && value) {
      // allow-regels negeren (conservatief: disallow wint)
    }
  }
  return { sitemaps, disallowedPaths };
}

/**
 * Matcht een pad tegen een robots-disallow-patroon.
 * Ondersteunt wildcard `*` (elke reeks) en `$`-eind-anchor (RFC 9309).
 * `Disallow: /` wordt bewust overgeslagen: een security-scanner heeft
 * expliciete toestemming om de site te crawlen, en een blanket-disallow
 * zou elke scan blokkeren.
 */
export function isPathDisallowed(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === "/") continue;
    if (pattern.endsWith("$")) {
      const prefix = pattern.slice(0, -1).replace(/\*$/, "");
      if (prefix === "") {
        if (path === "") return true;
      } else if (path.startsWith(prefix)) return true;
      continue;
    }
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix)) return true;
    } else if (path === pattern || path.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`)) {
      return true;
    } else if (path === pattern) {
      return true;
    }
  }
  return false;
}

const SPA_MARKERS = [
  "__NEXT_DATA__",
  "__remixContext",
  "__remixManifest",
  "__sveltekit",
  "window.__NUXT__",
];

/** Detecteert een SPA-framework uit inline markers (besluit 5). */
export function detectSpaFramework(html: string): boolean {
  return SPA_MARKERS.some((marker) => html.includes(marker));
}

const PATH_TOKEN_RE = /["'`](\/[a-zA-Z0-9_\-./%]*[a-zA-Z0-9_\-/%])["'`]/g;

/**
 * Conservatieve SPA-heuristiek (besluit 5; open vraag opgelost): extraheert
 * interne route-tokens uit inline JSON-manifests (`__NEXT_DATA__`,
 * `__remixContext`, `__sveltekit`). Chunk-naam-gebaseerde giswerk is bewust
 * NIET gedaan (instabiel per build). Statische `<a href>`-links (zie
 * `extractInternalLinks`) blijven de primaire bron; dit vult aan wat SPAs alleen
 * in hun runtime-manifest blootstellen.
 */
export function extractSpaRoutes(html: string, baseUrl: string): string[] {
  if (!detectSpaFramework(html)) return [];
  let baseHost: string | undefined;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    baseHost = undefined;
  }
  const urls: (string | null)[] = [];
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(html)) !== null) {
    const token = match[1];
    if (token.length > 200) continue;
    if (token.includes("//")) continue; // geen absolute URL's / protocol-relative
    if (token.includes(" ")) continue;
    urls.push(normalizeRouteUrl(token, baseHost));
  }
  return dedupeRoutes(urls);
}

/**
 * Rangschikt routes voor de top-N (besluit 4 / open vraag): de homepage (seed)
 * staat voorop, daarna sitemap-routes in sitemap-volgorde, dan link-gevonden
 * routes. `topN` wordt gebruikt om te bepalen op welke routes de dure
 * browser-checks (CWV/axe) zouden draaien.
 */
export function topRouteUrls(routes: ScanRoute[], topN: number): string[] {
  const seed = routes.find((r) => r.source === "seed") ?? routes[0];
  if (!seed) return [];
  const order: RouteSource[] = ["sitemap", "spa", "link"];
  const ordered = [seed.url];
  for (const source of order) {
    for (const route of routes) {
      if (route.url === seed.url) continue;
      if (route.source !== source) continue;
      if (!ordered.includes(route.url)) ordered.push(route.url);
    }
  }
  return ordered.slice(0, topN);
}
