import {
  classifyObservability,
  collectObservabilitySignals,
  observabilityEvidence,
  type InlineCheckLike,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";
import type { RateLimiter } from "../../rate-limit";

const CHECK_ID = "observability-signals";
const CHECK_NAME = "Observability & monitoring-signalen";

/**
 * Plan 79 — observability-signalen (G11 herdefinieerd). Passief, default-aan.
 * Hergebruikt de homepage-fetch (headers + HTML voor beacon-detectie) en doet
 * één extra guarded GET naar /.well-known/security.txt. De pure
 * `collectObservabilitySignals`/`classifyObservability` bepalen de uitkomst;
 * severity is altijd `info` (aanwezig = positief signaal, afwezig = neutrale
 * disclaimer). De check straft ontbrekende telemetrie nooit.
 */
export const observabilitySignalsCheck: CheckImplementation = {
  id: CHECK_ID,
  category: "http",
  async run(ctx): Promise<InlineCheckLike[]> {
    const fetchImpl = ctx.fetchPage ?? fetchPage;

    let page: Response;
    try {
      page = await fetchImpl(ctx.url, { timeoutMs: 10000 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "onbekende fout";
      return [
        {
          id: CHECK_ID,
          name: CHECK_NAME,
          status: "info",
          severity: "info",
          detail: `Observability-signalen niet uitvoerbaar: ${message}`,
        },
      ];
    }

    const html = await page.text().catch(() => "");
    const securityTxt = await hasSecurityTxt(ctx.url, fetchImpl, ctx.rateLimit);

    const signals = collectObservabilitySignals(page.headers, html, securityTxt);
    const { status, detail, severity } = classifyObservability(signals);

    return [
      {
        id: CHECK_ID,
        name: CHECK_NAME,
        status,
        severity,
        detail,
        evidence: observabilityEvidence(signals),
      },
    ];
  },
};

/**
 * Eén rate-limit-gated GET naar /.well-known/security.txt; faalt stil naar
 * `false`. De extra outbound-fetch gaat door dezelfde per-host rate-limit als
 * elke andere check die buiten de gedeelde homepage-fetch treedt (contract in
 * types.ts). Telt alleen als aanwezig wanneer de body daadwerkelijk het door
 * RFC 9116 verplichte `Contact:`-veld bevat — zo tellen SPA/soft-404
 * 200-fallbacks (die de homepage-HTML teruggeven) niet als security.txt.
 */
async function hasSecurityTxt(
  url: string,
  fetchImpl: typeof fetchPage,
  rateLimit: RateLimiter,
): Promise<boolean> {
  let target: string;
  let origin: string;
  try {
    const parsed = new URL("/.well-known/security.txt", url);
    target = parsed.toString();
    origin = parsed.origin;
  } catch {
    return false;
  }
  const rate = await rateLimit(`observability:${origin}`, 30, 60);
  if (!rate.ok) return false;
  try {
    const res = await fetchImpl(target, { timeoutMs: 8000, maxBytes: 64 * 1024 });
    if (!res.ok) return false;
    const body = await res.text().catch(() => "");
    return /^contact\s*:/im.test(body);
  } catch {
    return false;
  }
}
