import { describe, it, expect } from "vitest";
import {
  AI_ENGINE_BOTS,
  AEO_MATRIX_LIMITS,
  aiEngineLabels,
  aiEngineSchema,
  engineMatrixEvidenceSchema,
  engineMatrixRowSchema,
  evaluateEngineMatrix,
  extractLlmsTxtLinks,
  isPathAllowed,
  llmsTxtSchema,
  parseLlmsTxt,
  parseRobotsGroups,
  renderlessParse,
  robotsRulesForAgent,
  type EngineMatrix,
} from "../aeo-engine-matrix";

describe("aiEngine catalog (besluit 1, 4)", () => {
  it("definieert precies 7 engines met unieke labels en bots", () => {
    expect(aiEngineSchema.options).toHaveLength(7);
    expect(aiEngineSchema.options).toEqual([
      "chatgpt",
      "claude",
      "perplexity",
      "google",
      "copilot",
      "meta",
      "mistral",
    ]);
    expect(AI_ENGINE_BOTS).toHaveLength(7);
    const engines = new Set(AI_ENGINE_BOTS.map((b) => b.engine));
    expect(engines.size).toBe(7);
    for (const bot of AI_ENGINE_BOTS) {
      expect(aiEngineLabels[bot.engine].length).toBeGreaterThan(0);
      expect(bot.userAgentTokens.length).toBeGreaterThan(0);
      expect(bot.probeUserAgent.length).toBeGreaterThan(0);
    }
  });
});

describe("robotsRulesForAgent + isPathAllowed (besluit 2a)", () => {
  it("parseert groepen en sitemaps los van UA-groepen", () => {
    const robots = [
      "Sitemap: https://example.com/sitemap.xml",
      "User-agent: *",
      "Disallow: /private",
      "",
      "User-agent: GPTBot",
      "Disallow: /ai",
      "Allow: /ai/public",
    ].join("\n");
    const { groups, sitemaps } = parseRobotsGroups(robots);
    expect(groups).toHaveLength(2);
    expect(sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("kiest de specifieke UA-groep boven de *-groep", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /private",
      "",
      "User-agent: GPTBot",
      "Disallow:",
    ].join("\n");
    const rules = robotsRulesForAgent(robots, "GPTBot");
    expect(rules.disallow).toEqual([""]);
    expect(isPathAllowed(rules, "/anything")).toBe(true);
  });

  it("valt terug op de *-groep als er geen specifieke match is", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /private",
      "",
      "User-agent: GPTBot",
      "Disallow:",
    ].join("\n");
    const rules = robotsRulesForAgent(robots, "ClaudeBot");
    expect(rules.disallow).toEqual(["/private"]);
    expect(isPathAllowed(rules, "/private/x")).toBe(false);
    expect(isPathAllowed(rules, "/public")).toBe(true);
  });

  it("geeft alles toe als er geen groep matcht en geen * is", () => {
    const robots = "User-agent: GPTBot\nDisallow: /ai\n";
    const rules = robotsRulesForAgent(robots, "ClaudeBot");
    expect(isPathAllowed(rules, "/ai")).toBe(true);
  });

  it("lege Disallow: (waarde '') betekent alles toegestaan", () => {
    const robots = "User-agent: *\nDisallow:\n";
    const rules = robotsRulesForAgent(robots, "GPTBot");
    expect(isPathAllowed(rules, "/admin")).toBe(true);
  });

  it("Allow wint bij gelijke of langere patroonlengte", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /search",
      "Allow: /search/about",
    ].join("\n");
    const rules = robotsRulesForAgent(robots, "GPTBot");
    expect(isPathAllowed(rules, "/search/about")).toBe(true);
    expect(isPathAllowed(rules, "/search/query")).toBe(false);
  });

  it("ondersteunt wildcards in disallow-patronen", () => {
    const robots = "User-agent: *\nDisallow: /private/*\n";
    const rules = robotsRulesForAgent(robots, "GPTBot");
    expect(isPathAllowed(rules, "/private/secret")).toBe(false);
    expect(isPathAllowed(rules, "/public")).toBe(true);
  });

  it("matcht op UA-token met hoofdletterongevoeligheid", () => {
    const robots = "User-agent: gptbot\nDisallow: /ai\n";
    const rules = robotsRulesForAgent(robots, "GPTBot");
    expect(isPathAllowed(rules, "/ai")).toBe(false);
  });
});

describe("renderlessParse (besluit 2c)", () => {
  const okHtml = `<!doctype html><html><head><title>Welkom</title></head>
    <body><h1>Hoofdtekst</h1><p>${"voldoende tekst ".repeat(20)}</p></body></html>`;

  it("is parseable met titel, heading en voldoende tekst", () => {
    const result = renderlessParse(okHtml);
    expect(result.has_title).toBe(true);
    expect(result.title).toBe("Welkom");
    expect(result.heading_count).toBeGreaterThanOrEqual(1);
    expect(result.visible_text_chars).toBeGreaterThanOrEqual(
      AEO_MATRIX_LIMITS.minVisibleTextChars,
    );
    expect(result.parseable).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("is niet parseable zonder titel", () => {
    const html = `<html><body><h1>H</h1><p>${"tekst ".repeat(60)}</p></body></html>`;
    const result = renderlessParse(html);
    expect(result.parseable).toBe(false);
    expect(result.reason).toContain("geen <title>");
  });

  it("is niet parseable bij te lage tekstdichtheid (JS-only)", () => {
    const html = `<html><head><title>Leeg</title></head><body><div id="root"></div></body></html>`;
    const result = renderlessParse(html);
    expect(result.parseable).toBe(false);
    expect(result.reason).toContain("tekstdichtheid");
  });

  it("stript script- en style-content uit de zichtbare tekst", () => {
    const js = `<script>var x = "${"a".repeat(5000)}";</script>`;
    const html = `<html><head><title>T</title><style>.a{color:red}</style></head>
      <body><h1>H</h1><p>${"zichtbaar ".repeat(40)}</p>${js}</body></html>`;
    const result = renderlessParse(html);
    expect(result.visible_text_chars).toBeLessThan(5000);
    expect(result.parseable).toBe(true);
  });

  it("respecteert aangepaste drempels", () => {
    const html = `<html><head><title>T</title></head><body><h1>H</h1><p>kort</p></body></html>`;
    const result = renderlessParse(html, { minVisibleTextChars: 1, minHeadings: 1 });
    expect(result.parseable).toBe(true);
  });
});

describe("llms.txt-parse + link-validatie (besluit 3)", () => {
  it("extraheert markdown-links en kale URL's", () => {
    const body = "# Title\n\n- [Docs](https://example.com/docs)\n- https://example.com/about\n";
    expect(extractLlmsTxtLinks(body)).toEqual([
      "https://example.com/docs",
      "https://example.com/about",
    ]);
  });

  it("parseable met minstens één geldige http(s)-link", () => {
    const body = "# Title\n\n- [Docs](https://example.com/docs)\n";
    const result = parseLlmsTxt(body);
    expect(result.present).toBe(true);
    expect(result.parseable).toBe(true);
    expect(result.link_errors).toEqual([]);
  });

  it("verzamelt ongeldige links als link_errors", () => {
    const body = "# Title\n\n- [Bad](notaurl)\n- [Good](https://example.com)\n";
    const result = parseLlmsTxt(body);
    expect(result.parseable).toBe(true);
    expect(result.link_errors).toEqual(["notaurl"]);
  });

  it("leeg bestand is niet parseable", () => {
    const result = parseLlmsTxt("   \n\n  ");
    expect(result.present).toBe(true);
    expect(result.parseable).toBe(false);
  });

  it("kappt links op de limiet", () => {
    const lines = Array.from(
      { length: AEO_MATRIX_LIMITS.maxLlmsTxtLinks + 50 },
      (_, i) => `- https://example.com/${i}`,
    ).join("\n");
    expect(extractLlmsTxtLinks(lines)).toHaveLength(AEO_MATRIX_LIMITS.maxLlmsTxtLinks);
  });
});

describe("schemas", () => {
  it("engineMatrixRowSchema valideert een rij", () => {
    const row = { engine: "chatgpt", reachable: true, parseable: true, reason: "ok" };
    expect(engineMatrixRowSchema.parse(row)).toEqual(row);
  });

  it("llmsTxtSchema default link_errors naar []", () => {
    expect(llmsTxtSchema.parse({ present: false, parseable: false }).link_errors).toEqual([]);
  });

  it("engineMatrixEvidenceSchema valideert de volledige evidence", () => {
    const evidence = {
      kind: "aeo-engine-matrix",
      engine_matrix: [
        { engine: "chatgpt", reachable: true, parseable: true, reason: "ok" },
        { engine: "claude", reachable: false, parseable: false, reason: "robots.txt" },
      ],
      llms_txt: { present: true, parseable: true, link_errors: [] },
    };
    expect(engineMatrixEvidenceSchema.parse(evidence)).toEqual(evidence);
  });
});

describe("evaluateEngineMatrix (stap 4)", () => {
  const allOk: EngineMatrix = (
    ["chatgpt", "claude", "perplexity"] as const
  ).map((engine) => ({ engine, reachable: true, parseable: true, reason: "ok" }));

  it("pass als alle engines bereikbaar+parseerbaar en llms.txt ok", () => {
    const result = evaluateEngineMatrix({
      engine_matrix: allOk,
      llms_txt: { present: true, parseable: true, link_errors: [] },
    });
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
  });

  it("warn als llms.txt afwezig", () => {
    const result = evaluateEngineMatrix({
      engine_matrix: allOk,
      llms_txt: { present: false, parseable: false, link_errors: [] },
    });
    expect(result.status).toBe("warn");
  });

  it("fail als geen enkele engine bereikbaar is", () => {
    const matrix: EngineMatrix = [
      { engine: "chatgpt", reachable: false, parseable: false, reason: "robots.txt" },
      { engine: "claude", reachable: false, parseable: false, reason: "WAF 403" },
    ];
    const result = evaluateEngineMatrix({
      engine_matrix: matrix,
      llms_txt: { present: true, parseable: true, link_errors: [] },
    });
    expect(result.status).toBe("fail");
    expect(result.severity).toBe("high");
  });

  it("warn bij een lege matrix", () => {
    const result = evaluateEngineMatrix({
      engine_matrix: [],
      llms_txt: { present: false, parseable: false, link_errors: [] },
    });
    expect(result.status).toBe("warn");
  });
});
