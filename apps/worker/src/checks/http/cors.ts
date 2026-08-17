import { checkById, type InlineCheckLike } from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const SPOOFED_ORIGIN = "https://evil.example";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_HOST_PER_MINUTE = 10;

export type CorsProbe = {
  /** ACAO-waarde uit probe #1 (Origin: <spoofed>); null als de header ontbreekt. */
  acao: string | null;
  /** ACAC-waarde uit probe #1; null als de header ontbreekt. */
  acac: string | null;
  /** ACAO-waarde uit probe #2 (Origin: null); null als de header ontbreekt. */
  nullAcao: string | null;
};

function isTrue(value: string | null): boolean {
  return value !== null && value.trim().toLowerCase() === "true";
}

/**
 * Pure evaluatie van de twee CORS-probes (zie detectie-tabel in plan 66).
 * Volgorde: spoofed-reflectie (fail/warn) → null-reflectie (warn) →
 * `*`+credentials (warn) → `*` zonder credentials (info) → pass.
 */
export function evaluateCors(
  probe: CorsProbe,
  name: string,
  id = "cors",
): InlineCheckLike {
  const { acao, acac, nullAcao } = probe;
  const credentials = isTrue(acac);
  const evidence = `ACAO=${acao ?? "—"}; ACAC=${acac ?? "—"}`;

  if (acao !== null && acao === SPOOFED_ORIGIN) {
    if (credentials) {
      return {
        id,
        name,
        status: "fail",
        detail: `Access-Control-Allow-Origin reflecteert de spoofed Origin (${SPOOFED_ORIGIN}) mét Access-Control-Allow-Credentials: true — elke origin kan geauthenticeerde requests doen.`,
        evidence,
      };
    }
    return {
      id,
      name,
      status: "warn",
      detail: `Access-Control-Allow-Origin reflecteert de spoofed Origin (${SPOOFED_ORIGIN}) zonder credentials — willekeurige origins worden geaccepteerd.`,
      evidence,
    };
  }

  if (nullAcao !== null && nullAcao === "null") {
    return {
      id,
      name,
      status: "warn",
      detail: "Access-Control-Allow-Origin reflecteert `null` (gesandboxde iframe / data:-herkomst) — null-origin wordt geaccepteerd.",
      evidence: `ACAO(null-probe)=${nullAcao}`,
    };
  }

  if (acao !== null && acao.trim() === "*") {
    if (credentials) {
      return {
        id,
        name,
        status: "warn",
        detail: "Ongeldige CORS-combinatie: Access-Control-Allow-Origin: * samen met Access-Control-Allow-Credentials: true (browsers negeren ACAO=* in die geval, maar de configuratie is fout).",
        evidence,
      };
    }
    return {
      id,
      name,
      status: "info",
      detail: "Access-Control-Allow-Origin: * zonder credentials — publiek leesbaar, geen cross-origin risico voor geauthenticeerde data.",
      evidence,
    };
  }

  return {
    id,
    name,
    status: "pass",
    detail: acao === null
      ? "Geen Access-Control-Allow-Origin-header op de spoofed-origin probe — geen arbitraire origin-acceptatie."
      : `Access-Control-Allow-Origin staat op een vaste waarde ("${acao}") zonder reflectie van de spoofed Origin.`,
  };
}

function notCheckable(message: string, name: string): InlineCheckLike {
  return {
    id: "cors",
    name,
    status: "info",
    detail: `CORS niet controleerbaar: ${message}`,
  };
}

export const corsCheck: CheckImplementation = {
  id: "cors",
  category: "http",
  async run(ctx) {
    const entry = checkById("cors");
    const name = entry?.name ?? "CORS-configuratie";
    const host = safeHost(ctx.url);

    try {
      const probe1 = await probeOrigin(ctx, SPOOFED_ORIGIN, host);
      const probe2 = await probeOrigin(ctx, "null", host);

      return [
        evaluateCors(
          {
            acao: probe1.headers.get("access-control-allow-origin"),
            acac: probe1.headers.get("access-control-allow-credentials"),
            nullAcao: probe2.headers.get("access-control-allow-origin"),
          },
          name,
        ),
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [notCheckable(message, name)];
    }
  },
};

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Eén GET-probe met spoofed Origin-header, voorafgegaan door de per-host
 * Redis rate-limit (verplicht voor elke outbound check, conform plan 66 §6).
 */
async function probeOrigin(
  ctx: Parameters<CheckImplementation["run"]>[0],
  origin: string,
  host: string,
): Promise<Response> {
  const rate = await ctx.rateLimit(
    `cors:${host}`,
    RATE_LIMIT_PER_HOST_PER_MINUTE,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!rate.ok) {
    throw new Error(`rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s)`);
  }
  return fetchPage(ctx.url, {
    timeoutMs: 10000,
    headers: { Origin: origin },
  });
}
