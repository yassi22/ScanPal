import {
  checkById,
  classifyTakeover,
  extractSitemapLocs,
  registrableDomain,
  type InlineCheckLike,
  type SubdomainTakeover,
} from "@scanpal/shared";
import {
  enumerateSubdomains,
  probeCnameTakeover,
  toPunycode,
} from "@scanpal/scan-core";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_HOST_PER_MINUTE = 5;
/** Max kandidaten om te proberen (bescherming tegen een enorme CT-uitkomst). */
const MAX_CANDIDATES = 50;
/**
 * Max gelijktijdige CNAME-probes. Elke probe doet tot 3 sequentiële DNS-
 * lookups; zonder cap zou `MAX_CANDIDATES` (50) kandidaten ~150 lookups
 * tegelijk afvuren en de DNS-resolver overbelasten. Een kleine cap houdt de
 * belasting begrensd zonder de check merkbaar te vertragen.
 */
const PROBE_CONCURRENCY = 8;

/**
 * Mapt `items` met een begrensd aantal gelijktijdige workers, met behoud van
 * de invoer-volgorde in de output.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Subdomain-takeover catalog-check (plan 72). Passief: leest publieke DNS
 * (CNAME/A via de swappable resolver) + Certificate Transparency (crt.sh) en
 * haalt zelf de sitemap op (laag 1, los van `robots-sitemap`). Geen interactie
 * met de doelsite, geen `active`-gating.
 *
 * Severity (plan 72, besluit 3):
 * - high — dangling CNAME naar een bekende vulnerable-service-suffix.
 * - medium — dangling CNAME naar een onbekend target.
 * - info — geen vatbare subdomeinen (alles resolvend, geen CNAME, of geen
 *   subdomeinen gevonden).
 */
export const subdomainTakeoverCheck: CheckImplementation = {
  id: "subdomain-takeover",
  category: "http",
  async run(ctx) {
    const name =
      checkById("subdomain-takeover")?.name ??
      "Subdomain-takeover (dangling CNAME)";
    const host = safeHost(ctx.url);

    if (!host || !host.includes(".")) {
      return [
        {
          id: "subdomain-takeover",
          name,
          status: "info",
          detail: "Domein niet meetbaar: geen geldige hostnaam.",
        },
      ];
    }

    const rate = await ctx.rateLimit(
      `subdomain-takeover:${host}`,
      RATE_LIMIT_PER_HOST_PER_MINUTE,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rate.ok) {
      return [
        {
          id: "subdomain-takeover",
          name,
          status: "info",
          detail: `Subdomein-takeover niet controleerbaar: rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`,
        },
      ];
    }

    const apex = registrableDomain(host) ?? host;
    const apexPunycode = toPunycode(apex);

    // Laag 1: sitemap-hostnames (zelf ophalen, los van robots-sitemap).
    const sitemapHosts = await collectSitemapHosts(ctx).catch(() => []);

    let enumeration: {
      candidates: string[];
      sources: ("sitemap" | "crtsh")[];
      ct_failed: boolean;
    };
    try {
      enumeration = await enumerateSubdomains(apexPunycode, sitemapHosts, {
        fetchImpl: globalThis.fetch.bind(globalThis),
      });
    } catch {
      return [
        {
          id: "subdomain-takeover",
          name,
          status: "info",
          detail: "Subdomein-enumeratie niet uitvoerbaar (DNS/CT-fout).",
        },
      ];
    }

    const candidates = enumeration.candidates.slice(0, MAX_CANDIDATES);
    const probes = await mapWithConcurrency(
      candidates,
      PROBE_CONCURRENCY,
      async (sub) => ({ sub, probe: await probeCnameTakeover(sub) }),
    );

    const vulnerable: SubdomainTakeover["vulnerable"] = [];
    for (const { sub, probe } of probes) {
      const c = classifyTakeover(probe);
      if (c.severity === "high" || c.severity === "medium") {
        vulnerable.push({
          subdomain: sub,
          cname_target: probe.cname_target ?? "",
          service: c.service,
          severity: c.severity,
        });
      }
    }

    const result: SubdomainTakeover = {
      subdomains_found: candidates,
      vulnerable,
      sources: enumeration.sources,
      ct_failed: enumeration.ct_failed,
    };

    return [evaluateSubdomainTakeover(result, name)];
  },
};

/**
 * Pure evaluatie van één subdomein-takeover-meting → één InlineCheckLike
 * (plan 72, stap 3). `evidence` is een JSON-string met de gevonden subdomeinen
 * en de vatbare kandidaten. crt.sh-faal degradeert naar info (enumeratie
 * onvolledig, geen onterechte score-straf).
 */
export function evaluateSubdomainTakeover(
  measurement: SubdomainTakeover,
  name: string,
): InlineCheckLike {
  const evidence = JSON.stringify(measurement);
  const high = measurement.vulnerable.filter((v) => v.severity === "high");
  const medium = measurement.vulnerable.filter((v) => v.severity === "medium");

  if (high.length > 0) {
    const detail =
      `${high.length} dangling CNAME${high.length === 1 ? "" : "s"} naar bekende vulnerable service` +
      ` (${high.map((v) => `${v.subdomain} → ${v.cname_target}`).join(", ")}). ` +
      `Mogelijk vatbaar op subdomain-takeover — verifieer en verwijder de CNAME of her-claim het eindpunt.`;
    return {
      id: "subdomain-takeover",
      name,
      status: "fail",
      detail,
      evidence,
    };
  }

  if (medium.length > 0) {
    const detail =
      `${medium.length} dangling CNAME${medium.length === 1 ? "" : "s"} naar onbekend target` +
      ` (${medium.map((v) => `${v.subdomain} → ${v.cname_target}`).join(", ")}). ` +
      `Target resolvend niet — mogelijk vatbaar op takeover (niet bevestigd).`;
    return {
      id: "subdomain-takeover",
      name,
      status: "warn",
      detail,
      evidence,
    };
  }

  // Geen vatbare subdomeinen. Vermeld ct.sh-faal als enumeratie onvolledig is.
  const parts: string[] = [];
  if (measurement.subdomains_found.length > 0) {
    parts.push(`${measurement.subdomains_found.length} subdomeinen gevonden, alle resolvend`);
  } else {
    parts.push("geen subdomeinen gevonden");
  }
  if (measurement.ct_failed) {
    parts.push("crt.sh niet bereikbaar — enumeratie onvolledig (alleen sitemap)");
  }
  return {
    id: "subdomain-takeover",
    name,
    status: "info",
    detail: `${parts.join("; ")}.`,
    evidence,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Haalt de sitemap op en extraheert hostnames (laag 1, plan 72). Fetcht
 * /robots.txt voor de `Sitemap:`-directive, anders /sitemap.xml. Parseert
 * `<loc>`-URL's en houdt unieke hostnames over. Failure-resistent: bij een
 * falende fetch retourneert de helper een lege lijst (de check valt terug op
 * crt.sh-only).
 */
async function collectSitemapHosts(ctx: {
  url: string;
  fetchPage?: typeof fetchPage;
}): Promise<string[]> {
  const fetchImpl = ctx.fetchPage ?? fetchPage;
  const origin = originOf(ctx.url);

  const robotsRes = await fetchImpl(`${origin}/robots.txt`, {
    timeoutMs: 8000,
  })
    .then(async (res) => ({ res, text: await res.text().catch(() => "") }))
    .catch(() => null);
  const robotsText = robotsRes?.text ?? "";
  const sitemapDirective = robotsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^sitemap:\s*/i.test(l));
  const sitemapUrl = sitemapDirective
    ? sitemapDirective.replace(/^sitemap:\s*/i, "").trim()
    : `${origin}/sitemap.xml`;

  const sitemapRes = await fetchImpl(sitemapUrl, { timeoutMs: 8000 })
    .then(async (res) => ({ res, text: await res.text().catch(() => "") }))
    .catch(() => null);
  const xml = sitemapRes?.text ?? "";
  if (!xml) return [];

  const hosts = new Set<string>();
  for (const loc of extractSitemapLocs(xml)) {
    try {
      hosts.add(new URL(loc).hostname.toLowerCase());
    } catch {
      // ongeldige URL overslaan
    }
  }
  return [...hosts];
}

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}
