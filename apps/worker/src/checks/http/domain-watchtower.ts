import { checkById, type InlineCheckLike } from "@scanpal/shared";
import { measureDomain } from "@scanpal/scan-core";
import type { CheckImplementation } from "../types";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_HOST_PER_MINUTE = 5;
const EXPIRY_WARN_DAYS = 30;
const TLS_RUNWAY_WARN_DAYS = 14;

/**
 * Domain watchtower catalog-check (plan 56, stap 2). Combineert RDAP
 * (+whois-fallback) + DNS (NS/DNSSEC/CAA) + TLS-expiry in één meting via
 * `measureDomain` (scan-core) — dezelfde bron als de dagelijkse watch, zodat
 * scan en watch dezelfde domein-status leveren (plan 56, acceptatiecriteria).
 *
 * Finding-uitvoer: stil (info met countdown-waarden) als alles ok; `warn` bij
 * expiry < 30 d, TLS-runway < 14 d of DNSSEC uit; `fail` bij een verlopen
 * domeinregistratie. NS-drift wordt alleen in de dagelijkse watch gedetecteerd
 * (plan 56, open vraag 3 — geen dubbele events in handmatige scans).
 */
export const domainWatchtowerCheck: CheckImplementation = {
  id: "domain-watchtower",
  category: "http",
  async run(ctx) {
    const name = checkById("domain-watchtower")?.name ?? "Domain watchtower";
    const host = safeHost(ctx.url);

    if (!host || !host.includes(".")) {
      return [
        {
          id: "domain-watchtower",
          name,
          status: "info",
          detail: "Domein niet meetbaar: geen geldige hostnaam.",
        },
      ];
    }

    const rate = await ctx.rateLimit(
      `domain-watchtower:${host}`,
      RATE_LIMIT_PER_HOST_PER_MINUTE,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rate.ok) {
      return [
        {
          id: "domain-watchtower",
          name,
          status: "info",
          detail: `Domein niet controleerbaar: rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`,
        },
      ];
    }

    let result;
    try {
      result = await measureDomain(host, {
        fetchImpl: globalThis.fetch.bind(globalThis),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [
        {
          id: "domain-watchtower",
          name,
          status: "info",
          detail: `Domein niet controleerbaar: ${message}`,
        },
      ];
    }

    return [evaluateDomainMeasurement(result.measurement, name, new Date())];
  },
};

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / 86_400_000);
}

/**
 * Pure evaluatie van één meting → één InlineCheckLike (plan 56, stap 2). De
 * `evidence` is een JSON-string met de volledige meting (countdowns + badges)
 * zodat de UI en plan 56's watchtower-widget deze kunnen hergebruiken.
 */
export function evaluateDomainMeasurement(
  measurement: {
    domain_expiry: string | null;
    domain_registrar: string | null;
    dnssec_enabled: boolean | null;
    caa_present: boolean | null;
    tls_expiry: string | null;
    nameservers: string[] | null;
    caa_records: string[] | null;
  },
  name: string,
  now: Date = new Date(),
): InlineCheckLike {
  const expiryDays = daysUntil(measurement.domain_expiry, now);
  const tlsDays = daysUntil(measurement.tls_expiry, now);

  const evidence = JSON.stringify(measurement);

  // Fail: verlopen domeinregistratie.
  if (expiryDays !== null && expiryDays < 0) {
    return {
      id: "domain-watchtower",
      name,
      status: "fail",
      detail: `Domeinregistratie is verlopen (${Math.abs(expiryDays)} d geleden). Registrar: ${measurement.domain_registrar ?? "onbekend"}.`,
      evidence,
    };
  }

  // Warn: expiry binnen 30 d, TLS-runway < 14 d, of DNSSEC uit.
  const reasons: string[] = [];
  if (expiryDays !== null && expiryDays < EXPIRY_WARN_DAYS) {
    reasons.push(`domein verloopt over ${expiryDays} d`);
  }
  if (tlsDays !== null && tlsDays < TLS_RUNWAY_WARN_DAYS) {
    reasons.push(`TLS-certificaat verloopt over ${tlsDays} d`);
  }
  if (measurement.dnssec_enabled === false) {
    reasons.push("DNSSEC uitgeschakeld");
  }

  if (reasons.length > 0) {
    return {
      id: "domain-watchtower",
      name,
      status: "warn",
      detail: `Domein-afwijking: ${reasons.join(", ")}. Registrar: ${measurement.domain_registrar ?? "onbekend"}.`,
      evidence,
    };
  }

  // Stil bij OK: één info-finding met de countdown-waarden (plan 56, contract).
  const countdowns: string[] = [];
  if (expiryDays !== null) countdowns.push(`expiry ${expiryDays} d`);
  if (tlsDays !== null) countdowns.push(`tls ${tlsDays} d`);
  countdowns.push(`DNSSEC ${measurement.dnssec_enabled ? "aan" : "onbekend"}`);
  countdowns.push(`CAA ${measurement.caa_present ? "aanwezig" : "afwezig"}`);

  return {
    id: "domain-watchtower",
    name,
    status: "info",
    detail: `Domein gezond — ${countdowns.join(", ")}. Registrar: ${measurement.domain_registrar ?? "onbekend"}.`,
    evidence,
  };
}
