import {
  COMPLIANCE_LIMITS,
  checkById,
  detectBannerElement,
  detectCmp,
  detectConsentApi,
  detectGdprSignals,
  extractFooterLinks,
  findLegalLinks,
  findPrivacyPolicyLink,
  parseContactEmail,
  parseLastUpdated,
  type ComplianceEvidence,
  type ComplianceSignal,
  type FooterLink,
  type InlineCheckLike,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

/**
 * Compliance-pijler (plan 61): vijf passieve checks op de homepage (HTML/DOM-
 * analyse, géén cookies plaatsen, géén interactie met de banner). Eén
 * implementatie produceert alle catalog-check-ids zodat de pagina-HTML en de
 * footer-links gedeeld worden (1 homepage-fetch + max 1 extra fetch voor de
 * privacy-policy-pagina). Bevindingen zijn observaties met uitleg (evidence =
 * `{ kind: "compliance", signals }`), geen juridische oordelen.
 */
export const COMPLIANCE_CHECK_IDS = [
  "cookie-banner",
  "consent-api",
  "privacy-policy",
  "legal-pages",
  "gdpr-signals",
] as const;

const NAME_BY_ID: Record<string, string> = {
  "cookie-banner": "Cookie-banner / CMP-detectie",
  "consent-api": "Consent-API",
  "privacy-policy": "Privacy-policy",
  "legal-pages": "Legal-pagina's",
  "gdpr-signals": "GDPR-signalen",
};

function checkName(id: string): string {
  return checkById(id)?.name ?? NAME_BY_ID[id] ?? id;
}

function signalsToEvidence(signals: ComplianceSignal[]): ComplianceEvidence {
  return { kind: "compliance", signals };
}

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

async function rateLimit(
  ctx: Parameters<CheckImplementation["run"]>[0],
  host: string,
): Promise<boolean> {
  const result = await ctx.rateLimit(
    `compliance:${host}`,
    COMPLIANCE_LIMITS.requestsPerHostPerMinute,
    COMPLIANCE_LIMITS.rateLimitWindowSeconds,
  );
  return result.ok;
}

function cookieBannerCheck(html: string): InlineCheckLike {
  const cmpSignals = detectCmp(html);
  if (cmpSignals.length > 0) {
    return {
      id: "cookie-banner",
      name: checkName("cookie-banner"),
      status: "pass",
      detail: cmpSignals.map((s) => s.detail).join(" "),
      evidence: signalsToEvidence(cmpSignals),
    };
  }
  const bannerSignals = detectBannerElement(html);
  if (bannerSignals.length > 0) {
    return {
      id: "cookie-banner",
      name: checkName("cookie-banner"),
      status: "warn",
      detail:
        "Een cookie-banner-element gevonden, maar geen bekende CMP herkend. De toestemming-logica kan niet worden geverifieerd.",
      evidence: signalsToEvidence(bannerSignals),
    };
  }
  return {
    id: "cookie-banner",
    name: checkName("cookie-banner"),
    status: "warn",
    detail:
      "Geen cookie-banner of bekende CMP gevonden in de HTML. De site plaatst mogelijk cookies zonder dat bezoekers vooraf een keuze krijgen.",
    evidence: signalsToEvidence([
      {
        signal: "no-banner",
        detail: "Geen cookie-banner of bekende CMP gevonden in de HTML.",
      },
    ]),
  };
}

function consentApiCheck(html: string): InlineCheckLike {
  const signals = detectConsentApi(html);
  if (signals.length > 0) {
    return {
      id: "consent-api",
      name: checkName("consent-api"),
      status: "pass",
      detail: signals.map((s) => s.detail).join(" "),
      evidence: signalsToEvidence(signals),
    };
  }
  return {
    id: "consent-api",
    name: checkName("consent-api"),
    status: "warn",
    detail:
      "Geen consent-API-signalen gevonden (geen __tcfapi / googlefc / generieke CMP-global). Scripts kunnen mogelijk laden zonder expliciete toestemming.",
    evidence: signalsToEvidence([
      {
        signal: "no-consent-api",
        detail: "Geen consent-API-signalen gevonden in de HTML/scripts.",
      },
    ]),
  };
}

/**
 * Privacy-policy: footer-link op kernwoorden + (indien gevonden) één fetch van
 * de pagina voor bereikbaarheid, last-updated-datum en contact-e-mail.
 */
async function privacyPolicyCheck(
  ctx: Parameters<CheckImplementation["run"]>[0],
  html: string,
  links: FooterLink[],
  host: string,
): Promise<InlineCheckLike> {
  const privacyLink = findPrivacyPolicyLink(links);
  if (!privacyLink) {
    return {
      id: "privacy-policy",
      name: checkName("privacy-policy"),
      status: "warn",
      detail:
        "Geen privacy-policy-link gevonden in de footer. Bezoekers kunnen de privacyverklaring niet vanaf de homepage vinden.",
      evidence: signalsToEvidence([
        {
          signal: "no-privacy-policy",
          detail: "Geen privacy-policy-link gevonden in de footer-links.",
        },
      ]),
    };
  }

  const signals: ComplianceSignal[] = [
    {
      signal: "privacy-policy-link",
      detail: `Privacy-policy-link gevonden: ${privacyLink.href}.`,
    },
  ];

  try {
    if (await rateLimit(ctx, host)) {
      const res = await fetchPage(privacyLink.href, {
        timeoutMs: COMPLIANCE_LIMITS.fetchTimeoutMs,
      });
      if (res.status >= 400) {
        return {
          id: "privacy-policy",
          name: checkName("privacy-policy"),
          status: "fail",
          detail: `De privacy-policy-pagina is onbereikbaar (HTTP ${res.status}).`,
          evidence: signalsToEvidence([
            {
              signal: "privacy-policy-unreachable",
              detail: `HTTP ${res.status} op ${privacyLink.href}.`,
            },
          ]),
        };
      }
      const body = await res.text();
      const updated = parseLastUpdated(body);
      const email = parseContactEmail(body);
      signals.push(
        updated
          ? {
              signal: "last-updated",
              detail: `Privacy-policy heeft een last-updated-datum: ${updated}.`,
            }
          : {
              signal: "no-last-updated",
              detail: "Geen last-updated-datum gevonden op de privacy-policy-pagina.",
            },
      );
      signals.push(
        email
          ? { signal: "contact-email", detail: `Contact-e-mail gevonden: ${email}.` }
          : {
              signal: "no-contact-email",
              detail: "Geen contact-e-mailadres gevonden op de privacy-policy-pagina.",
            },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "onbekende fout";
    return {
      id: "privacy-policy",
      name: checkName("privacy-policy"),
      status: "warn",
      detail: `Privacy-policy-pagina kon niet worden opgehaald (${message}).`,
      evidence: signalsToEvidence([
        {
          signal: "privacy-policy-fetch-error",
          detail: `Fetch-fout: ${message}.`,
        },
      ]),
    };
  }

  const hasUpdated = signals.some((s) => s.signal === "last-updated");
  const hasEmail = signals.some((s) => s.signal === "contact-email");
  return {
    id: "privacy-policy",
    name: checkName("privacy-policy"),
    status: hasUpdated && hasEmail ? "pass" : "warn",
    detail: signals.map((s) => s.detail).join(" "),
    evidence: signalsToEvidence(signals),
  };
}

function legalPagesCheck(links: FooterLink[]): InlineCheckLike {
  const legal = findLegalLinks(links);
  const signals: ComplianceSignal[] = [];
  if (legal.terms) {
    signals.push({
      signal: "terms-link",
      detail: `Terms-of-service-link gevonden: ${legal.terms.href}.`,
    });
  } else {
    signals.push({
      signal: "no-terms",
      detail: "Geen terms-of-service-link gevonden in de footer.",
    });
  }
  if (legal.imprint) {
    signals.push({
      signal: "imprint-link",
      detail: `Imprint-link gevonden: ${legal.imprint.href}.`,
    });
  } else {
    signals.push({
      signal: "no-imprint",
      detail: "Geen imprint-link gevonden in de footer.",
    });
  }
  if (legal.contact) {
    signals.push({
      signal: "contact-link",
      detail: `Contact-link gevonden: ${legal.contact.href}.`,
    });
  } else {
    signals.push({
      signal: "no-contact",
      detail: "Geen contact-link gevonden in de footer.",
    });
  }

  const found = Object.keys(legal).length;
  return {
    id: "legal-pages",
    name: checkName("legal-pages"),
    status: found >= 2 ? "pass" : "warn",
    detail: signals.map((s) => s.detail).join(" "),
    evidence: signalsToEvidence(signals),
  };
}

function gdprSignalsCheck(html: string): InlineCheckLike {
  const signals = detectGdprSignals(html);
  if (signals.length > 0) {
    return {
      id: "gdpr-signals",
      name: checkName("gdpr-signals"),
      status: "pass",
      detail: signals.map((s) => s.detail).join(" "),
      evidence: signalsToEvidence(signals),
    };
  }
  return {
    id: "gdpr-signals",
    name: checkName("gdpr-signals"),
    status: "warn",
    detail:
      "Geen GDPR-signalen gevonden (geen DSAR/data-verwijderingsverwijzing, geen IAB-TCF/CMP-signaal, geen GDPR-referenties).",
    evidence: signalsToEvidence([
      {
        signal: "no-gdpr-signals",
        detail: "Geen GDPR-signalen gevonden in de HTML.",
      },
    ]),
  };
}

export const complianceCheck: CheckImplementation = {
  id: "compliance",
  category: "compliance",
  async run(ctx) {
    const host = safeHost(ctx.url);
    const origin = safeOrigin(ctx.url);

    let html = "";
    let fetchError: string | null = null;
    try {
      if (!(await rateLimit(ctx, host))) {
        fetchError = "rate-limit bereikt";
      } else {
        const res = await fetchPage(ctx.url, {
          timeoutMs: COMPLIANCE_LIMITS.fetchTimeoutMs,
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) {
          fetchError = `geen HTML-pagina (${contentType || "onbekend content-type"})`;
        } else {
          html = await res.text();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "onbekende fout";
      fetchError = message;
    }

    if (fetchError) {
      const detail = `Compliance-checks niet controleerbaar: ${fetchError}`;
      return COMPLIANCE_CHECK_IDS.map((id) => ({
        id,
        name: checkName(id),
        status: "warn" as const,
        detail,
      }));
    }

    const links = extractFooterLinks(html, origin);
    return [
      cookieBannerCheck(html),
      consentApiCheck(html),
      await privacyPolicyCheck(ctx, html, links, host),
      legalPagesCheck(links),
      gdprSignalsCheck(html),
    ];
  },
};