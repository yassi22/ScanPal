import { z } from "zod";

/**
 * Compliance-pijler (plan 61): passieve signaal-detectie voor cookies/consent
 * en legal-pagina's. Puur functioneel (geen netwerk, geen DB, geen cookies
 * plaatsen) — de netwerklogica woont in de worker-check
 * (`apps/worker/src/checks/http/compliance.ts`). Bevindingen zijn observaties
 * met uitleg, geen juridische oordelen (zie COMPLIANCE_DISCLAIMER).
 */

/** Eén signaal: een korte id + menselijke uitleg ("waarom is dit een signaal"). */
export const complianceSignalSchema = z.object({
  signal: z.string(),
  detail: z.string(),
});
export type ComplianceSignal = z.infer<typeof complianceSignalSchema>;

/** Gestructureerd evidence van de compliance-checks (per check een signalen-lijst). */
export const complianceEvidenceSchema = z.object({
  kind: z.literal("compliance"),
  signals: z.array(complianceSignalSchema),
});
export type ComplianceEvidence = z.infer<typeof complianceEvidenceSchema>;

/**
 * Verplichte disclaimer-regel: compliance-bevindingen zijn geautomatiseerde
 * observaties op basis van de publiekelijk toegankelijke HTML/scripts en geen
 * juridisch advies. Getoond in de UI en het export-rapport.
 */
export const COMPLIANCE_DISCLAIMER =
  "Compliance-bevindingen zijn geautomatiseerde observaties op basis van de publiekelijk toegankelijke HTML en scripts van de site. Ze zijn geen juridisch advies en geen volledige verplichtingencontrole (zoals GDPR/CCPA).";

/** Beleefdheids-limieten voor de compliance-checks (per-host rate-limit). */
export const COMPLIANCE_LIMITS = {
  fetchTimeoutMs: 10_000,
  requestsPerHostPerMinute: 30,
  rateLimitWindowSeconds: 60,
  /** Max footer-links die worden geanalyseerd (anti-blowup op enorme footers). */
  maxFooterLinks: 40,
} as const;

/** Bekende CMP/cookie-banner-leveranciers (herkenning via script-klassen/ids). */
export type CmpProvider = {
  id: string;
  name: string;
  /** Case-insensitive markers (klassen, ids, domeinen, global-namen). */
  patterns: string[];
};

export const CMP_PROVIDERS: CmpProvider[] = [
  { id: "onetrust", name: "OneTrust", patterns: ["onetrust", "optanonconsent", "ot-sdk", "onetrust-consent-sdk", "cookielaw", "otsdkstub"] },
  { id: "cookiebot", name: "Cookiebot", patterns: ["cookiebot", "cookieconsent", "consent.cookiebot", "cb-enabled"] },
  { id: "usercentrics", name: "Usercentrics", patterns: ["usercentrics", "uc-widget", "usercentrics.com", "uc-btn"] },
  { id: "axeptio", name: "Axeptio", patterns: ["axeptio", "axept.io", "axeptio-cookies"] },
  { id: "didomi", name: "Didomi", patterns: ["didomi", "didomi-popup", "didomi-host"] },
  { id: "quantcast", name: "Quantcast Choice", patterns: ["quantcast", "qc-cmp2", "choice-privacy"] },
  { id: "sourcepoint", name: "Sourcepoint", patterns: ["sourcepoint", "ccpa-cmp", "unified-id", "sp-message-delivery"] },
  { id: "trustarc", name: "TrustArc", patterns: ["trustarc"] },
  { id: "consentmanager", name: "Consentmanager", patterns: ["consentmanager", "consentmanager.net"] },
  { id: "iubenda", name: "iubenda", patterns: ["iubenda", "iubenda_cs", "iubenda-consent"] },
  { id: "complianz", name: "Complianz", patterns: ["complianz", "cmplz-cookiebanner", "complianz-gdpr"] },
  { id: "ketch", name: "Ketch", patterns: ["ketch", "ketch.io", "ketch-cmp"] },
  { id: "pandectes", name: "Pandectes", patterns: ["pandectes", "gdpr-ccpa", "ccpa-gdpr"] },
  { id: "cookieinformation", name: "Cookie Information", patterns: ["cookieinformation", "cookie-information", "cookieinfo"] },
  { id: "onetrust-geolocation", name: "OneTrust geolocation", patterns: ["geolocationrules", "georules"] },
  { id: "cookiebot-autoconsent", name: "Cookiebot Autoconsent", patterns: ["autoconsent", "cookie-autoconsent"] },
];

/**
 * Detecteert bekende CMP's in de HTML (script-klassen/ids, globale namen,
 * domeinen). Passief: alleen strings matchen, niets uitvoeren of accepteren.
 */
export function detectCmp(html: string): ComplianceSignal[] {
  const lowered = html.toLowerCase();
  const found = CMP_PROVIDERS.filter((provider) =>
    provider.patterns.some((pattern) => lowered.includes(pattern)),
  );
  return found.map((provider) => ({
    signal: `cmp:${provider.id}`,
    detail: `${provider.name} herkend (marker "${provider.patterns.find((p) => lowered.includes(p))}").`,
  }));
}

/** Generieke cookie-banner-markers (geen bekende CMP). */
const BANNER_MARKERS = [
  "cookie-banner",
  "cookiebanner",
  "consent-banner",
  "gdpr-banner",
  "cookie-notice",
  "cookiebar",
  "cookie-bar",
  "consent_modal",
  "cookie__wrapper",
  "cookieconsent",
  "accepteer cookies",
  "accept cookies",
  "alle cookies",
];

/** Detecteert een generiek banner-element (als er geen bekende CMP is). */
export function detectBannerElement(html: string): ComplianceSignal[] {
  const lowered = html.toLowerCase();
  const found = BANNER_MARKERS.filter((marker) => lowered.includes(marker));
  if (found.length === 0) return [];
  return [
    {
      signal: "banner-element",
      detail: `Cookie-banner-element gevonden (${found.slice(0, 3).join(", ")}).`,
    },
  ];
}

/** Consent-API-globals die in HTML/scripts worden blootgesteld. */
const CONSENT_API_MARKERS: { id: string; name: string; markers: string[] }[] = [
  {
    id: "iab-tcf",
    name: "IAB TCF",
    markers: ["__tcfapi", "tcfapi", "iabtcf", "tcstring", "gdprapplies"],
  },
  {
    id: "google-consent-mode",
    name: "Google consent mode",
    markers: ["googlefc", "consent mode", "google consent", "gtag('consent'", "consent.update"],
  },
  {
    id: "generic-cmp",
    name: "Generieke CMP-global",
    markers: ["window.__cmp", "__cmp(", "__cmpframe", "getconsent"],
  },
];

/** Detecteert consent-API-signalen (`__tcfapi` / `googlefc` / generieke CMP-global). */
export function detectConsentApi(html: string): ComplianceSignal[] {
  const lowered = html.toLowerCase();
  return CONSENT_API_MARKERS.filter((api) =>
    api.markers.some((marker) => lowered.includes(marker)),
  ).map((api) => ({
    signal: `consent-api:${api.id}`,
    detail: `${api.name}-signalen gevonden (scripts kunnen vóór toestemming worden opgehouden).`,
  }));
}

/** Eén gefilterde link uit de footer met leestekst. */
export type FooterLink = {
  text: string;
  href: string;
};

/**
 * Extraheert `<a href>`-links uit de `<footer>` (fallback: hele pagina).
 * Resolved tegen `baseUrl`; alleen http(s)-links; mailto/tel/javascript/data/
 * anchors worden overgeslagen. Begrensd op `maxFooterLinks`.
 */
export function extractFooterLinks(html: string, baseUrl: string): FooterLink[] {
  const footerMatch = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i);
  const scope = footerMatch ? footerMatch[1] : html;
  const links: FooterLink[] = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scope)) !== null) {
    const href = match[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|data:|#)/i.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    links.push({ text, href: resolved.href });
    if (links.length >= COMPLIANCE_LIMITS.maxFooterLinks) break;
  }
  return links;
}

const PRIVACY_KEYWORDS = [
  "privacy",
  "privacybeleid",
  "privacyverklaring",
  "privacy policy",
  "privacy notice",
  "datenschutz",
  "datenschutzerklärung",
  "politique de confidentialité",
  "politica de privacidad",
];

/** Vindt de privacy-policy-link op basis van naam-kernwoorden (NL/EN/DE/FR/ES). */
export function findPrivacyPolicyLink(links: FooterLink[]): FooterLink | null {
  return (
    links.find(
      (link) =>
        PRIVACY_KEYWORDS.some(
          (keyword) =>
            link.text.toLowerCase().includes(keyword) ||
            link.href.toLowerCase().includes(keyword),
        ),
    ) ?? null
  );
}

const TERMS_KEYWORDS = [
  "terms",
  "voorwaarden",
  "algemene voorwaarden",
  "terms of service",
  "termos",
  "conditions générales",
  "agb",
  "términos",
];
const IMPRINT_KEYWORDS = [
  "imprint",
  "impressum",
  "colophon",
  "colofon",
  "legal notice",
  "mentions légales",
];
const CONTACT_KEYWORDS = [
  "contact",
  "contact us",
  "contacteer",
  "neem contact",
  "kontakt",
  "contactez",
];

export type LegalKind = "terms" | "imprint" | "contact";

/** Vindt terms/imprint/contact-links in de footer (voor zover aanwezig). */
export function findLegalLinks(
  links: FooterLink[],
): Partial<Record<LegalKind, FooterLink>> {
  const result: Partial<Record<LegalKind, FooterLink>> = {};
  for (const link of links) {
    const haystack = `${link.text} ${link.href}`.toLowerCase();
    if (!result.terms && TERMS_KEYWORDS.some((k) => haystack.includes(k))) {
      result.terms = link;
      continue;
    }
    if (!result.imprint && IMPRINT_KEYWORDS.some((k) => haystack.includes(k))) {
      result.imprint = link;
      continue;
    }
    if (!result.contact && CONTACT_KEYWORDS.some((k) => haystack.includes(k))) {
      result.contact = link;
      continue;
    }
  }
  return result;
}

/** Last-updated: meta-tags, `<time datetime>`, of tekstpatronen (NL/EN/DE/FR). */
export function parseLastUpdated(html: string): string | null {
  const meta = html.match(
    /<meta[^>]+(?:name|itemprop|property)=["'](?:dateModified|last-modified|lastmod|date)["'][^>]*content=["']([^"']+)["']/i,
  );
  if (meta) return meta[1].trim();
  const time = html.match(/<time[^>]*\bdatetime=["']([^"']+)["']/i);
  if (time) return time[1].trim();
  const text = html.match(
    /(?:last updated|last modified|modified on|updated on|laatst bijgewerkt|bijgewerkt op|gewijzigd op|geändert am|mise à jour)[:\s]*([0-9]{1,2}\s+[a-zàâçéèêëïîôûùü]+\.?\s+[0-9]{4}|[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2})/i,
  );
  return text ? text[1].trim() : null;
}

/** Eerste contact-e-mailadres dat in de pagina-tekst voorkomt (indien aanwezig). */
export function parseContactEmail(html: string): string | null {
  const match = html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0] : null;
}

const GDPR_MARKERS: { id: string; name: string; markers: string[] }[] = [
  {
    id: "dsar",
    name: "DSAR / data-verwijdering",
    markers: [
      "data subject access request",
      "dsar",
      "right to access",
      "access request",
      "delete my data",
      "data deletion",
      "verwijder mijn gegevens",
      "recht op inzage",
      "gegevens verwijderen",
      "droit d'accès",
      "effacement",
    ],
  },
  {
    id: "iab-tcf",
    name: "IAB-TCF/CMP",
    markers: ["__tcfapi", "tcfapi", "tcstring", "gdprapplies", "iab tcf"],
  },
  {
    id: "gdpr-references",
    name: "GDPR-referenties",
    markers: ["gdpr", "avg", "dsgvo", "règlement général"],
  },
];

/** Detecteert GDPR-signalen (DSAR/data-verwijdering, IAB-TCF, GDPR-referenties). */
export function detectGdprSignals(html: string): ComplianceSignal[] {
  const lowered = html.toLowerCase();
  return GDPR_MARKERS.filter((marker) =>
    marker.markers.some((m) => lowered.includes(m)),
  ).map((marker) => ({
    signal: `gdpr:${marker.id}`,
    detail: `${marker.name} gevonden.`,
  }));
}