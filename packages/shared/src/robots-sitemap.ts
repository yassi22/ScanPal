import { z } from "zod";

/**
 * Feature 36 — robots.txt & sitemap geldigheid/kwaliteit. De crawler (plan 54)
 * parst robots.txt en sitemap.xml alleen voor route-discovery; deze check
 * produceert findings over de bestanden zelf: aanwezigheid, syntaxis,
 * sitemap-referenties en URL-kwaliteit. Pure helpers in packages/shared; de
 * worker doet de fetches en evalueert met `evaluateRobotsSitemap`.
 */

export const robotsSitemapEvidenceSchema = z.object({
  kind: z.literal("robots-sitemap"),
  robots_txt: z.object({
    present: z.boolean(),
    status: z.number().int(),
    size_bytes: z.number().int(),
    user_agents: z.array(z.string()),
    has_wildcard_agent: z.boolean(),
    disallow_rules: z.number().int(),
    allow_rules: z.number().int(),
    sitemap_directives: z.array(z.string()),
    parse_errors: z.array(z.string()),
  }),
  sitemap: z.object({
    present: z.boolean(),
    status: z.number().int(),
    is_xml: z.boolean(),
    url_count: z.number().int(),
    valid_urls: z.number().int(),
    invalid_samples: z.array(z.string()),
    discovered_from_robots: z.boolean(),
    error: z.string().nullable(),
  }),
});
export type RobotsSitemapEvidence = z.infer<typeof robotsSitemapEvidenceSchema>;

export type RobotsTxtInspection = {
  present: boolean;
  status: number;
  sizeBytes: number;
  userAgents: string[];
  hasWildcardAgent: boolean;
  disallowRules: number;
  allowRules: number;
  sitemapDirectives: string[];
  parseErrors: string[];
};

export type SitemapInspection = {
  present: boolean;
  status: number;
  isXml: boolean;
  urlCount: number;
  validUrls: number;
  invalidSamples: string[];
  discoveredFromRobots: boolean;
  error: string | null;
};

export function emptyRobotsInspection(status = 0): RobotsTxtInspection {
  return {
    present: false,
    status,
    sizeBytes: 0,
    userAgents: [],
    hasWildcardAgent: false,
    disallowRules: 0,
    allowRules: 0,
    sitemapDirectives: [],
    parseErrors: [],
  };
}

export function emptySitemapInspection(status = 0): SitemapInspection {
  return {
    present: false,
    status,
    isXml: false,
    urlCount: 0,
    validUrls: 0,
    invalidSamples: [],
    discoveredFromRobots: false,
    error: null,
  };
}

/**
 * Parseert robots.txt voor kwaliteitscheck (feature 36). Anders dan
 * `parseRobotsTxt` (routes.ts, plan 54) wordt ook gescoord op syntaxis,
 * user-agent-dekking en sitemap-referenties; ongeldige regels belanden in
 * `parseErrors` (mits ze een waarde bevatten — lege/commentaar-regels niet).
 */
export function inspectRobotsTxt(
  text: string | null,
  status = 0,
): RobotsTxtInspection {
  const inspection = emptyRobotsInspection(status);
  if (!text || !text.trim()) return inspection;

  inspection.present = true;
  inspection.sizeBytes = text.length;
  const agents = new Set<string>();

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.split("#")[0].trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      if (trimmed.length > 40) {
        inspection.parseErrors.push(`${trimmed.slice(0, 40)}… (geen ':'-scheiding)`);
      } else {
        inspection.parseErrors.push(`${trimmed} (geen ':'-scheiding)`);
      }
      continue;
    }
    const field = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    switch (field) {
      case "user-agent":
        if (value) {
          const agent = value.slice(0, 100);
          agents.add(agent);
          if (agent === "*") inspection.hasWildcardAgent = true;
        }
        break;
      case "disallow":
        if (value || trimmed.endsWith(":")) inspection.disallowRules += 1;
        break;
      case "allow":
        if (value || trimmed.endsWith(":")) inspection.allowRules += 1;
        break;
      case "sitemap":
        if (value) {
          inspection.sitemapDirectives.push(value.slice(0, 500));
        } else {
          inspection.parseErrors.push("Sitemap:-regel zonder URL");
        }
        break;
      default:
        // Onbekende velden (crawl-delay, host, extensions) zijn legaal —
        // geen parse-fout.
        break;
    }
  }

  inspection.userAgents = [...agents].slice(0, 10);
  return inspection;
}

/** Valideert één <loc>-waarde als http(s)-URL. */
function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parseert een sitemap-body (urlset óf sitemapindex) voor kwaliteitscheck
 * (feature 36): XML-vorm, <loc>-telling en URL-geldigheid. `error` vult zich
 * alleen bij een onherstelbaar ongeldig document.
 */
export function inspectSitemap(
  xml: string | null,
  status = 0,
  discoveredFromRobots = false,
): SitemapInspection {
  const inspection = emptySitemapInspection(status);
  inspection.discoveredFromRobots = discoveredFromRobots;
  if (!xml || !xml.trim()) {
    inspection.error = "leeg document";
    return inspection;
  }

  const text = xml.trim();
  inspection.present = true;
  const lower = text.slice(0, 2000).toLowerCase();
  if (!lower.includes("<urlset") && !lower.includes("<sitemapindex")) {
    inspection.isXml = false;
    inspection.error = "geen <urlset>/<sitemapindex>-root (geen geldige sitemap)";
    return inspection;
  }
  inspection.isXml = true;

  const locRe = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  const rawLocs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = locRe.exec(text)) !== null) {
    rawLocs.push(match[1].trim());
    if (rawLocs.length >= 1000) break;
  }

  if (rawLocs.length === 0) {
    inspection.error = "geen <loc>-entries gevonden";
    return inspection;
  }

  inspection.urlCount = rawLocs.length;
  inspection.validUrls = rawLocs.filter(isValidHttpUrl).length;
  inspection.invalidSamples = rawLocs
    .filter((raw) => !isValidHttpUrl(raw))
    .slice(0, 5);
  return inspection;
}

export function robotsSitemapEvidence(
  robots: RobotsTxtInspection,
  sitemap: SitemapInspection,
): RobotsSitemapEvidence {
  return {
    kind: "robots-sitemap",
    robots_txt: {
      present: robots.present,
      status: robots.status,
      size_bytes: robots.sizeBytes,
      user_agents: robots.userAgents,
      has_wildcard_agent: robots.hasWildcardAgent,
      disallow_rules: robots.disallowRules,
      allow_rules: robots.allowRules,
      sitemap_directives: robots.sitemapDirectives,
      parse_errors: robots.parseErrors,
    },
    sitemap: {
      present: sitemap.present,
      status: sitemap.status,
      is_xml: sitemap.isXml,
      url_count: sitemap.urlCount,
      valid_urls: sitemap.validUrls,
      invalid_samples: sitemap.invalidSamples,
      discovered_from_robots: sitemap.discoveredFromRobots,
      error: sitemap.error,
    },
  };
}

export type RobotsSitemapVerdict = {
  status: "pass" | "warn" | "fail";
  issues: string[];
};

/**
 * Bepaalt status + issues voor de robots-sitemap-check:
 * - fail: robots.txt ontbreekt · sitemap gedeclareerd in robots.txt maar
 *   onbereikbaar/ongeldig · sitemap aanwezig maar niet geldig XML.
 * - warn: geen `User-agent: *` · robots.txt met parse-fouten · sitemap
 *   afwezig (geen directive én /sitemap.xml 404) · sitemap met ongeldige
 *   URL-entries.
 */
export function evaluateRobotsSitemap(
  robots: RobotsTxtInspection,
  sitemap: SitemapInspection,
): RobotsSitemapVerdict {
  const issues: string[] = [];

  if (!robots.present) {
    return {
      status: "fail",
      issues: ["robots.txt ontbreekt of is leeg"],
    };
  }
  if (!robots.hasWildcardAgent) {
    issues.push("geen `User-agent: *`-groep voor generieke crawlers");
  }
  if (robots.parseErrors.length > 0) {
    issues.push(`${robots.parseErrors.length} ongeldige robots.txt-regel(s)`);
  }

  if (sitemap.discoveredFromRobots && !sitemap.present) {
    issues.push("sitemap gedeclareerd in robots.txt maar onbereikbaar");
  } else if (sitemap.present && !sitemap.isXml) {
    issues.push("sitemap is geen geldig XML-document");
  } else if (sitemap.present && sitemap.error) {
    issues.push(`sitemap ongeldig: ${sitemap.error}`);
  } else if (!sitemap.present && robots.sitemapDirectives.length === 0) {
    issues.push("geen sitemap.xml gevonden en geen Sitemap:-directive in robots.txt");
  }

  if (sitemap.present && sitemap.invalidSamples.length > 0) {
    issues.push(
      `${sitemap.invalidSamples.length} ongeldige URL(s) in de sitemap (eerste: ${sitemap.invalidSamples[0]})`,
    );
  }

  if (issues.length === 0) {
    return { status: "pass", issues: [] };
  }
  const hasFail = issues.some((issue) => issue.startsWith("robots.txt ontbreekt") ||
    issue.startsWith("sitemap gedeclareerd") ||
    issue.startsWith("sitemap is geen") ||
    issue.startsWith("sitemap ongeldig"));
  return { status: hasFail ? "fail" : "warn", issues };
}
