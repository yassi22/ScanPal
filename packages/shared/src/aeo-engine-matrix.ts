import { z } from "zod";
import { findingSeveritySchema } from "./severity";

/**
 * AEO per-engine matrix (plan 55): proxy-meting van AI-bot-toegang per engine
 * (robots.txt per UA, HTTP-probe met bot-UA, "renderless parse") + llms.txt-
 * aanwezigheids- en parsetest. Puur functioneel (geen netwerk, geen DB) — de
 * netwerklogica woont in de worker-check (`apps/worker/src/checks/http/`).
 * Geen echte AI-API-calls; alles is een proxy-signaal op basis van de
 * botspecificaties hieronder.
 */

/** AI-engines die in de matrix worden getest (besluit 1). */
export const aiEngineSchema = z.enum([
  "chatgpt",
  "claude",
  "perplexity",
  "google",
  "copilot",
  "meta",
  "mistral",
]);
export type AiEngine = z.infer<typeof aiEngineSchema>;

export const aiEngineLabels: Record<AiEngine, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  google: "Google AI",
  copilot: "Microsoft Copilot",
  meta: "Meta AI",
  mistral: "Mistral",
};

/**
 * Bot-specificaties per engine (besluit 4): engine + weergavenaam + de
 * User-agent-token(s) die de officiële crawler van die engine gebruikt. De
 * robots-parse matcht de UA-groep op basis van deze tokens (zie
 * `robotsRulesForAgent`). Onderhoud hier de catalog — nooit elders.
 */
export type AiEngineBot = {
  engine: AiEngine;
  /** Weergavenaam (UI + labels). */
  name: string;
  /**
   * User-agent-token(s) die in robots.txt `User-agent:`-groepen gebruikt worden
   * voor deze bot. Meestal één token (bijv. "GPTBot"); sommige engines delen een
   * groep of hebben meerdere tokens (eerste wint bij matchen).
   */
  userAgentTokens: string[];
  /** UA-string voor de HTTP-probe (besluit 2b). */
  probeUserAgent: string;
};

export const AI_ENGINE_BOTS: AiEngineBot[] = [
  {
    engine: "chatgpt",
    name: "ChatGPT (GPTBot)",
    userAgentTokens: ["GPTBot"],
    probeUserAgent: "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  },
  {
    engine: "claude",
    name: "Claude (ClaudeBot)",
    userAgentTokens: ["ClaudeBot"],
    probeUserAgent: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com/claude-bot)",
  },
  {
    engine: "perplexity",
    name: "Perplexity (PerplexityBot)",
    userAgentTokens: ["PerplexityBot"],
    probeUserAgent: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://docs.perplexity.ai/docs/perplexity-bot)",
  },
  {
    engine: "google",
    name: "Google AI (Google-Extended)",
    userAgentTokens: ["Google-Extended"],
    probeUserAgent: "Mozilla/5.0 (compatible; Google-Extended; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)",
  },
  {
    engine: "copilot",
    name: "Microsoft Copilot (Bingbot)",
    userAgentTokens: ["Bingbot"],
    probeUserAgent: "Mozilla/5.0 (compatible; bingbot/2.0; +https://www.bing.com/bingbot.htm)",
  },
  {
    engine: "meta",
    name: "Meta AI (CCBot)",
    userAgentTokens: ["CCBot"],
    probeUserAgent: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  },
  {
    engine: "mistral",
    name: "Mistral (MistralAI)",
    userAgentTokens: ["MistralAI"],
    probeUserAgent: "Mozilla/5.0 (compatible; MistralAI/1.0; +https://mistral.ai)",
  },
];

/** Eén engine-rij in de matrix (besluit 1: één finding met `engine_matrix`). */
export const engineMatrixRowSchema = z.object({
  engine: aiEngineSchema,
  /** Bot kan de site bereiken (robots.txt staat de UA toe + HTTP-probe slaagt). */
  reachable: z.boolean(),
  /** Kerncontent zonder JavaScript te parsen (titel, headings, tekstdichtheid). */
  parseable: z.boolean(),
  /** Korte reden waarom de bot (on)bereikbaar of (on)parseerbaar is. */
  reason: z.string(),
});
export type EngineMatrixRow = z.infer<typeof engineMatrixRowSchema>;

export const engineMatrixSchema = z.array(engineMatrixRowSchema);
export type EngineMatrix = z.infer<typeof engineMatrixSchema>;

/** llms.txt-aanwezigheids- en parsetest (besluit 3). */
export const llmsTxtSchema = z.object({
  present: z.boolean(),
  /** Bestand is geldig te parsen en bevat geldige http(s)-links. */
  parseable: z.boolean(),
  /** Ongeldige links gevonden tijdens validatie. */
  link_errors: z.array(z.string()).default([]),
});
export type LlmsTxt = z.infer<typeof llmsTxtSchema>;

/** Gestructureerd evidence van de aeo-engine-matrix-check. */
export const engineMatrixEvidenceSchema = z.object({
  kind: z.literal("aeo-engine-matrix"),
  engine_matrix: engineMatrixSchema,
  llms_txt: llmsTxtSchema,
});
export type EngineMatrixEvidence = z.infer<typeof engineMatrixEvidenceSchema>;

/** Limieten (besluit 3 + beleefdheid, besluit 5). */
export const AEO_MATRIX_LIMITS = {
  /** Max grootte llms.txt (10 MB). Groter → niet geparsed. */
  maxLlmsTxtBytes: 10 * 1024 * 1024,
  /** Max aantal links dat uit llms.txt wordt gevalideerd. */
  maxLlmsTxtLinks: 200,
  /** Per-engine probe-timeout (robots-probe + UA-probe). */
  probeTimeoutMs: 10_000,
  /** Per-host Redis rate-limit (verplicht uit AGENTS.md). */
  requestsPerHostPerMinute: 30,
  /** Rate-limit-venster. */
  rateLimitWindowSeconds: 60,
  /** Minimale zichtbare tekstdichtheid (karakters) voor "parseable" (besluit 2c). */
  minVisibleTextChars: 200,
  /** Minimaal aantal headings voor "parseable". */
  minHeadings: 1,
} as const;

/**
 * robots.txt-groep voor één UA (besluit 2a). `allow`/`disallow` zijn de
 * patronen die gelden voor de groep waarvan de `User-agent:`-regel matcht met
 * de bot-tokens. Lege `Disallow:` (waarde "") = alles toegestaan.
 */
export type RobotsRules = {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
};

type RobotsGroup = {
  userAgents: string[];
  allow: string[];
  disallow: string[];
};

/**
 * Parseert robots.txt in groepen (RFC 9309-light): een groep = één of meer
 * `User-agent:`-regels gevolgd door `Allow:`/`Disallow:`-regels. Comments en
 * lege regels worden genegeerd; `Sitemap:`-directives zijn groep-onafhankelijk.
 */
export function parseRobotsGroups(robots: string): {
  groups: RobotsGroup[];
  sitemaps: string[];
} {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let pendingAgents: string[] = [];

  const lines = robots.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // Opeenvolgende User-agent-regels horen bij dezelfde groep (tot een
      // Allow/Disallow ze afsluit).
      if (current && (current.allow.length > 0 || current.disallow.length > 0)) {
        groups.push(current);
        current = null;
        pendingAgents = [];
      }
      pendingAgents.push(value.toLowerCase());
      if (!current) current = { userAgents: [], allow: [], disallow: [] };
      current.userAgents.push(value.toLowerCase());
      continue;
    }
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "allow" || field === "disallow") {
      if (!current) {
        current = { userAgents: pendingAgents, allow: [], disallow: [] };
      }
      current[field].push(value);
      pendingAgents = [];
      continue;
    }
    // overige velden (crawl-delay, …) negeren
  }
  if (current) groups.push(current);
  return { groups, sitemaps };
}

/**
 * Vindt de robots-groep die geldt voor `userAgentToken` (besluit 2a). Matchen:
 * de groep waarvan minstens één `User-agent:`-waarde een case-insensitive
 * prefix is van (of gelijk aan) het bot-token. `*` is de fallback-groep. Bij
 * meerdere matches wint de meest specifieke (langste) UA-string.
 */
export function robotsRulesForAgent(
  robots: string,
  userAgentToken: string,
): RobotsRules {
  const { groups, sitemaps } = parseRobotsGroups(robots);
  const token = userAgentToken.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  let star: RobotsGroup | null = null;
  for (const group of groups) {
    for (const ua of group.userAgents) {
      if (ua === "*") {
        star = star ?? group;
        continue;
      }
      if (token.includes(ua) || ua.includes(token)) {
        if (ua.length > bestLen) {
          best = group;
          bestLen = ua.length;
        }
      }
    }
  }
  const chosen = best ?? star;
  if (!chosen) return { allow: [], disallow: [], sitemaps };
  return {
    allow: chosen.allow,
    disallow: chosen.disallow,
    sitemaps,
  };
}

/** Wildcard-match (`*` = any, `$` = end-of-path) zoals robots.txt het bedoelt. */
function pathMatchesPattern(path: string, pattern: string): boolean {
  if (pattern === "") return false;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\$$/, "");
  const re = new RegExp(`^${escaped}`);
  return re.test(path);
}

/**
 * Bepaalt of een pad toegestaan is volgens de robots-regels (longest-match
 * wint; bij gelijke lengte wint Allow; lege `Disallow:` = alles toegestaan).
 */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let bestLen = -1;
  let bestAllow = true;
  for (const pat of rules.disallow) {
    if (pat === "") return true;
    if (pathMatchesPattern(path, pat)) {
      const len = pat.length;
      if (len > bestLen) {
        bestLen = len;
        bestAllow = false;
      }
    }
  }
  for (const pat of rules.allow) {
    if (pathMatchesPattern(path, pat)) {
      const len = pat.length;
      if (len > bestLen || (len === bestLen && bestAllow === false)) {
        bestLen = len;
        bestAllow = true;
      }
    }
  }
  return bestAllow;
}

/** Resultaat van de "renderless parse" (besluit 2c): content zonder JS. */
export const renderlessParseSchema = z.object({
  has_title: z.boolean(),
  title: z.string().nullable(),
  heading_count: z.number().int().min(0),
  visible_text_chars: z.number().int().min(0),
  parseable: z.boolean(),
  reason: z.string(),
});
export type RenderlessParse = z.infer<typeof renderlessParseSchema>;

const TAG_RE = /<[^>]+>/g;
const SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style\b[\s\S]*?<\/style>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HEADING_RE = /<h[1-6]\b[^>]*>/gi;

/**
 * Parseert ruwe HTML zonder JavaScript (besluit 2c): titel, aantal headings en
 * zichtbare tekstdichtheid. `parseable` = titel aanwezig + >=
 * `minHeadings` headings + >= `minVisibleTextChars` zichtbare tekst.
 */
export function renderlessParse(
  html: string,
  options: { minHeadings?: number; minVisibleTextChars?: number } = {},
): RenderlessParse {
  const minHeadings = options.minHeadings ?? AEO_MATRIX_LIMITS.minHeadings;
  const minVisibleTextChars =
    options.minVisibleTextChars ?? AEO_MATRIX_LIMITS.minVisibleTextChars;

  const titleMatch = TITLE_RE.exec(html);
  const rawTitle = titleMatch?.[1]?.replace(TAG_RE, "").trim() ?? "";
  const hasTitle = rawTitle.length > 0;

  const withoutScripts = html.replace(SCRIPT_RE, "").replace(STYLE_RE, "");
  const headingCount = (withoutScripts.match(HEADING_RE) ?? []).length;
  const visibleText = withoutScripts.replace(TAG_RE, " ").replace(/\s+/g, " ").trim();
  const visibleTextChars = visibleText.length;

  const reasons: string[] = [];
  if (!hasTitle) reasons.push("geen <title>");
  if (headingCount < minHeadings) reasons.push(`te weinig headings (${headingCount})`);
  if (visibleTextChars < minVisibleTextChars) {
    reasons.push(`tekstdichtheid te laag (${visibleTextChars} tekens)`);
  }
  const parseable = reasons.length === 0;
  return {
    has_title: hasTitle,
    title: hasTitle ? rawTitle : null,
    heading_count: headingCount,
    visible_text_chars: visibleTextChars,
    parseable,
    reason: parseable ? "ok" : reasons.join("; "),
  };
}

const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const BARE_URL_RE = /(^|\s)(https?:\/\/[^\s)]+)/g;

/**
 * Extraheert links uit een llms.txt-bestand (markdown `[text](url)` of kale
 * http(s)-URL's). Afgekapt op `maxLlmsTxtLinks`.
 */
export function extractLlmsTxtLinks(body: string): string[] {
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MD_LINK_RE.exec(body)) !== null) {
    const url = match[1].trim();
    if (url) links.add(url);
  }
  while ((match = BARE_URL_RE.exec(body)) !== null) {
    const url = match[2].trim();
    if (url) links.add(url);
  }
  return [...links].slice(0, AEO_MATRIX_LIMITS.maxLlmsTxtLinks);
}

/**
 * Parseert + valideert llms.txt-content (besluit 3). `present` wordt door de
 * caller gezet op basis van de HTTP-status; deze helper doet de parse + link-
 * validatie. `parseable` = niet-leeg én minstens één geldige http(s)-link.
 */
export function parseLlmsTxt(body: string): LlmsTxt {
  const trimmed = body.trim();
  if (!trimmed) {
    return { present: true, parseable: false, link_errors: [] };
  }
  const links = extractLlmsTxtLinks(trimmed);
  const linkErrors: string[] = [];
  let valid = 0;
  for (const link of links) {
    try {
      const url = new URL(link);
      if (url.protocol === "http:" || url.protocol === "https:") {
        valid++;
      } else {
        linkErrors.push(link);
      }
    } catch {
      linkErrors.push(link);
    }
  }
  return {
    present: true,
    parseable: valid > 0,
    link_errors: linkErrors,
  };
}

/**
 * Aggregatie (stap 4): bouwt de matrix-rijen en bepaalt de overall check-
 * status/severity. `pass` = alle engines bereikbaar+parseerbaar én llms.txt
 * aanwezig+parseerbaar; `warn` = deels; `fail` = alles geblokkeerd.
 */
export function evaluateEngineMatrix(input: {
  engine_matrix: EngineMatrix;
  llms_txt: LlmsTxt;
}): { status: "pass" | "warn" | "fail"; severity: z.infer<typeof findingSeveritySchema> } {
  const reachableCount = input.engine_matrix.filter((row) => row.reachable).length;
  const parseableCount = input.engine_matrix.filter((row) => row.parseable).length;
  const total = input.engine_matrix.length;
  const llmsOk = input.llms_txt.present && input.llms_txt.parseable;

  if (total === 0) {
    return { status: "warn", severity: "medium" };
  }
  if (reachableCount === 0) {
    return { status: "fail", severity: "high" };
  }
  const allOk =
    reachableCount === total && parseableCount === total && llmsOk;
  if (allOk) return { status: "pass", severity: "info" };
  return { status: "warn", severity: "medium" };
}
