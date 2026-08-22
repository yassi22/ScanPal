import {
  checkById,
  registrableDomain,
  spfLookupCount,
  type InlineCheckLike,
  type EmailDns,
} from "@scanpal/shared";
import { resolveEmailDns, toPunycode } from "@scanpal/scan-core";
import type { CheckImplementation } from "../types";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_HOST_PER_MINUTE = 5;
const SPF_LOOKUP_WARN = 10;

/**
 * DNS & e-mail catalog-check (plan 68). Passief: leest alleen publieke DNS-
 * records (SPF, DMARC, MX, DKIM-selector-probe) via de swappable resolver in
 * scan-core. Geen interactie met de doelsite, geen extra HTTP-request.
 *
 * Severity-regels (plan 68, besluit 3):
 * - high — DMARC ontbreekt óf `p=none` op een domein met verzendende MX.
 * - medium — SPF ontbreekt, of SPF eindigt op `+all`/`?all`, of DMARC
 *   `p=quarantine` zonder `rua`.
 * - low — meerdere SPF-records (RFC-overtreding), SPF > 10 DNS-lookups, geen
 *   DKIM-selector gevonden (info-niveau).
 * - info — apex heeft geen MX → SPF/DMARC-bevindingen degraderen naar info.
 */
export const dnsEmailCheck: CheckImplementation = {
  id: "dns-email",
  category: "http",
  async run(ctx) {
    const name = checkById("dns-email")?.name ?? "DNS & e-mail (SPF/DKIM/DMARC)";
    const host = safeHost(ctx.url);

    if (!host || !host.includes(".")) {
      return [
        {
          id: "dns-email",
          name,
          status: "info",
          detail: "Domein niet meetbaar: geen geldige hostnaam.",
        },
      ];
    }

    const rate = await ctx.rateLimit(
      `dns-email:${host}`,
      RATE_LIMIT_PER_HOST_PER_MINUTE,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rate.ok) {
      return [
        {
          id: "dns-email",
          name,
          status: "info",
          detail: `E-mail-DNS niet controleerbaar: rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`,
        },
      ];
    }

    const apex = registrableDomain(host) ?? host;
    const apexPunycode = toPunycode(apex);

    let result: EmailDns;
    try {
      result = await resolveEmailDns(apexPunycode, {
        fetchImpl: globalThis.fetch.bind(globalThis),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [
        {
          id: "dns-email",
          name,
          status: "info",
          detail: `E-mail-DNS niet controleerbaar: ${message}`,
        },
      ];
    }

    return [evaluateEmailDns(result, name)];
  },
};

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Pure evaluatie van één e-mail-DNS-meting → één InlineCheckLike (plan 68,
 * stap 2). `evidence` is een JSON-string met de ruwe records. Domeinen zonder
 * MX degraderen naar info (geen onterechte score-straf — plan 68, besluit 3).
 */
export function evaluateEmailDns(
  measurement: EmailDns,
  name: string,
): InlineCheckLike {
  const evidence = JSON.stringify(measurement);
  const hasMx = measurement.mx.length > 0;

  // Geen MX → domein verstuurt waarschijnlijk geen mail; degradeer naar info.
  if (!hasMx) {
    return {
      id: "dns-email",
      name,
      status: "info",
      detail:
        "Geen MX-record gevonden — domein verstuurt waarschijnlijk geen e-mail. SPF/DMARC-bevindingen niet van toepassing.",
      evidence,
    };
  }

  const reasons: { severity: "fail" | "warn"; text: string }[] = [];

  // DMARC: ontbrekend of p=none op een verzendend domein → high (spoofbaar).
  if (measurement.dmarc === null) {
    reasons.push({
      severity: "fail",
      text: "DMARC-record ontbreekt (domein is spoofbaar)",
    });
  } else if (measurement.dmarc.policy === "none") {
    reasons.push({
      severity: "fail",
      text: "DMARC-policy is `p=none` (monitor-only, niet afdwingend)",
    });
  } else if (measurement.dmarc.policy === "quarantine" && !measurement.dmarc.rua_present) {
    reasons.push({
      severity: "warn",
      text: "DMARC `p=quarantine` zonder `rua` (geen aggregatie-rapportage)",
    });
  }

  // SPF: ontbrekend of permissief.
  if (measurement.spf === null) {
    reasons.push({
      severity: "warn",
      text: "SPF-record ontbreekt",
    });
  } else if (
    measurement.spf.all_qualifier === "+all" ||
    measurement.spf.all_qualifier === "?all"
  ) {
    reasons.push({
      severity: "warn",
      text: `SPF eindigt op \`${measurement.spf.all_qualifier}\` (te permissief)`,
    });
  }

  // Low-severity signalen (niet score-verlagend, wel vermeld).
  const lowSignals: string[] = [];
  if (measurement.spf_record_count > 1) {
    lowSignals.push(
      `meerdere SPF-records (${measurement.spf_record_count}, RFC-overtreding)`,
    );
  }
  if (measurement.spf) {
    const lookups = spfLookupCount(measurement.spf.raw);
    if (lookups > SPF_LOOKUP_WARN) {
      lowSignals.push(`SPF > ${SPF_LOOKUP_WARN} DNS-lookups (${lookups}, RFC 7208)`);
    }
  }
  if (measurement.dkim_selectors_found.length === 0) {
    lowSignals.push("geen DKIM-selector gevonden (best-effort, niet bevestigend)");
  }

  if (reasons.length === 0) {
    const okParts: string[] = ["SPF aanwezig", "DMARC aanwezig"];
    if (measurement.dmarc?.policy === "reject") okParts.push("DMARC `p=reject`");
    if (measurement.dkim_selectors_found.length > 0) {
      okParts.push(`DKIM ${measurement.dkim_selectors_found.join(", ")}`);
    }
    const detail =
      lowSignals.length > 0
        ? `E-mail-DNS in orde — ${okParts.join(", ")}. Let op: ${lowSignals.join("; ")}.`
        : `E-mail-DNS in orde — ${okParts.join(", ")}.`;
    return {
      id: "dns-email",
      name,
      status: "info",
      detail,
      evidence,
    };
  }

  const hasFail = reasons.some((r) => r.severity === "fail");
  const status: "fail" | "warn" = hasFail ? "fail" : "warn";
  const detail =
    `E-mail-DNS-afwijking: ${reasons.map((r) => r.text).join("; ")}.` +
    (lowSignals.length > 0 ? ` Let op: ${lowSignals.join("; ")}.` : "");

  return {
    id: "dns-email",
    name,
    status,
    detail,
    evidence,
  };
}
