import {
  AI_ENGINE_BOTS,
  AEO_MATRIX_LIMITS,
  checkById,
  evaluateEngineMatrix,
  isPathAllowed,
  parseLlmsTxt,
  renderlessParse,
  robotsRulesForAgent,
  type EngineMatrixEvidence,
  type EngineMatrixRow,
  type InlineCheckLike,
  type LlmsTxt,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

const RATE_LIMIT_PER_HOST_PER_MINUTE = AEO_MATRIX_LIMITS.requestsPerHostPerMinute;
const RATE_LIMIT_WINDOW_SECONDS = AEO_MATRIX_LIMITS.rateLimitWindowSeconds;

const NAME = "AEO engine-matrix & llms.txt";

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

export type ProbeOutcome =
  | { ok: true; status: number; html: string }
  | { ok: false; reason: string };

/**
 * Pure classificatie van één bot-UA-probe (besluit 2b/2c). 4xx/5xx → niet
 * bereikbaar (WAF/geblokkeerd); 2xx/3xx → bereikbaar, parseerbaarheid volgt uit
 * de renderless parse van de HTML.
 */
export function classifyProbe(
  status: number,
  html: string,
): ProbeOutcome {
  if (status >= 400) {
    return { ok: false, reason: `HTTP ${status} (bot geblokkeerd)` };
  }
  if (status >= 200 && status < 400) {
    return { ok: true, status, html };
  }
  return { ok: false, reason: `HTTP ${status}` };
}

/**
 * Bouwt de engine-matrix-rij uit robots-regels + probe-uitkomst (besluit 2a-c).
 * Als robots.txt de bot weigert, wordt de probe overgeslagen (beleegd: 0
 * extra verzoeken voor expliciet geweigerde bots).
 */
export function buildMatrixRow(input: {
  engine: EngineMatrixRow["engine"];
  userAgentToken: string;
  rules: ReturnType<typeof robotsRulesForAgent>;
  path: string;
  probe: ProbeOutcome;
}): EngineMatrixRow {
  if (!isPathAllowed(input.rules, input.path)) {
    return {
      engine: input.engine,
      reachable: false,
      parseable: false,
      reason: `robots.txt blokkeert ${input.userAgentToken}`,
    };
  }
  if (!input.probe.ok) {
    return {
      engine: input.engine,
      reachable: false,
      parseable: false,
      reason: input.probe.reason,
    };
  }
  const render = renderlessParse(input.probe.html);
  return {
    engine: input.engine,
    reachable: true,
    parseable: render.parseable,
    reason: render.parseable ? "ok" : `niet parseerbaar: ${render.reason}`,
  };
}

/** Korte menselijke samenvatting voor de finding-detail. */
export function summarizeMatrix(
  matrix: EngineMatrixRow[],
  llmsTxt: LlmsTxt,
): string {
  const reachable = matrix.filter((row) => row.reachable).length;
  const parseable = matrix.filter((row) => row.parseable).length;
  const llms = llmsTxt.present
    ? `llms.txt aanwezig (parseerbaar: ${llmsTxt.parseable ? "ja" : "nee"}${llmsTxt.link_errors.length > 0 ? `, ${llmsTxt.link_errors.length} ongeldige link(s)` : ""})`
    : "llms.txt afwezig";
  return `${reachable}/${matrix.length} bots bereikbaar, ${parseable}/${matrix.length} bots parseerbaar; ${llms}.`;
}

async function rateLimit(
  ctx: Parameters<CheckImplementation["run"]>[0],
  host: string,
): Promise<boolean> {
  const result = await ctx.rateLimit(
    `aeo-matrix:${host}`,
    RATE_LIMIT_PER_HOST_PER_MINUTE,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  return result.ok;
}

/** Eén fetch van robots.txt (cache voor de hele check — besluit 5). */
async function fetchRobots(
  ctx: Parameters<CheckImplementation["run"]>[0],
  origin: string,
  host: string,
): Promise<string> {
  if (!(await rateLimit(ctx, host))) {
    throw new Error("rate-limit op robots.txt");
  }
  try {
    const res = await fetchPage(`${origin}/robots.txt`, {
      timeoutMs: AEO_MATRIX_LIMITS.probeTimeoutMs,
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/** Fetch + parse van llms.txt (besluit 3); afwezig → present=false. */
async function fetchLlmsTxt(
  ctx: Parameters<CheckImplementation["run"]>[0],
  origin: string,
  host: string,
): Promise<LlmsTxt> {
  if (!(await rateLimit(ctx, host))) {
    return { present: false, parseable: false, link_errors: [] };
  }
  try {
    const res = await fetchPage(`${origin}/llms.txt`, {
      timeoutMs: AEO_MATRIX_LIMITS.probeTimeoutMs,
    });
    if (!res.ok) {
      return { present: false, parseable: false, link_errors: [] };
    }
    const body = await res.text();
    if (body.length > AEO_MATRIX_LIMITS.maxLlmsTxtBytes) {
      return { present: true, parseable: false, link_errors: [] };
    }
    return parseLlmsTxt(body);
  } catch {
    return { present: false, parseable: false, link_errors: [] };
  }
}

/** HTTP-probe met de bot-UA (besluit 2b); beleefdheid: 1 verzoek per engine. */
async function probeWithUa(
  ctx: Parameters<CheckImplementation["run"]>[0],
  ua: string,
  host: string,
): Promise<ProbeOutcome> {
  if (!(await rateLimit(ctx, host))) {
    return { ok: false, reason: "rate-limit" };
  }
  let res: Response;
  try {
    res = await fetchPage(ctx.url, {
      timeoutMs: AEO_MATRIX_LIMITS.probeTimeoutMs,
      headers: { "User-Agent": ua },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "onbekende fout";
    return { ok: false, reason: `niet bereikbaar (${message})` };
  }
  let html = "";
  try {
    html = await res.text();
  } catch {
    html = "";
  }
  return classifyProbe(res.status, html);
}

export const aeoEngineMatrixCheck: CheckImplementation = {
  id: "aeo-engine-matrix",
  category: "aeo",
  async run(ctx) {
    const entry = checkById("aeo-engine-matrix");
    const name = entry?.name ?? NAME;
    const host = safeHost(ctx.url);
    const origin = safeOrigin(ctx.url);
    const path = safePath(ctx.url);

    try {
      const robotsTxt = await fetchRobots(ctx, origin, host);
      const llmsTxt = await fetchLlmsTxt(ctx, origin, host);

      const matrix: EngineMatrixRow[] = [];
      for (const bot of AI_ENGINE_BOTS) {
        const token = bot.userAgentTokens[0];
        const rules = robotsRulesForAgent(robotsTxt, token);
        if (!isPathAllowed(rules, path)) {
          // robots weigert de bot — geen probe (beleefdheid, besluit 5).
          matrix.push({
            engine: bot.engine,
            reachable: false,
            parseable: false,
            reason: `robots.txt blokkeert ${token}`,
          });
          continue;
        }
        const probe = await probeWithUa(ctx, bot.probeUserAgent, host);
        matrix.push(buildMatrixRow({ engine: bot.engine, userAgentToken: token, rules, path, probe }));
      }

      const evalResult = evaluateEngineMatrix({ engine_matrix: matrix, llms_txt: llmsTxt });
      const evidence: EngineMatrixEvidence = {
        kind: "aeo-engine-matrix",
        engine_matrix: matrix,
        llms_txt: llmsTxt,
      };
      return [
        {
          id: "aeo-engine-matrix",
          name,
          status: evalResult.status,
          severity: evalResult.severity,
          detail: summarizeMatrix(matrix, llmsTxt),
          evidence,
        } satisfies InlineCheckLike,
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "aeo-engine-matrix",
          name,
          status: "info",
          detail: `AEO engine-matrix niet controleerbaar: ${message}`,
        },
      ];
    }
  },
};
