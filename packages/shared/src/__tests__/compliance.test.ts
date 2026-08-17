import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_DISCLAIMER,
  complianceEvidenceSchema,
  detectBannerElement,
  detectCmp,
  detectConsentApi,
  detectGdprSignals,
  extractFooterLinks,
  findLegalLinks,
  findPrivacyPolicyLink,
  parseContactEmail,
  parseLastUpdated,
  type FooterLink,
} from "../compliance";

const ONETRUST_HTML = `
<html><head><script src="https://cdn.cookielaw.org/consent/12345/otSDKStub.js"></script></head>
<body>
  <div id="onetrust-consent-sdk"></div>
  <footer>
    <a href="/privacy">Privacybeleid</a>
    <a href="/terms">Algemene voorwaarden</a>
    <a href="/contact">Contact</a>
    <a href="mailto:info@example.com">Mail</a>
  </footer>
</body></html>`;

describe("detectCmp (bekende CMP's)", () => {
  it("herkent OneTrust via script-klassen/ids", () => {
    const signals = detectCmp(ONETRUST_HTML);
    expect(signals.map((s) => s.signal)).toContain("cmp:onetrust");
    expect(signals[0].detail).toContain("OneTrust");
  });

  it("vindt geen CMP op een kale pagina", () => {
    expect(detectCmp("<html><body>Hello</body></html>")).toEqual([]);
  });

  it("herkent Cookiebot en Usercentrics markers", () => {
    const signals = detectCmp(
      '<script id="Cookiebot"></script><div class="uc-widget"></div>',
    );
    expect(signals.map((s) => s.signal)).toEqual(
      expect.arrayContaining(["cmp:cookiebot", "cmp:usercentrics"]),
    );
  });
});

describe("detectBannerElement (generiek)", () => {
  it("vindt een generiek banner-element zonder bekende CMP", () => {
    const signals = detectBannerElement(
      '<div class="cookie-banner"><button>Accepteer cookies</button></div>',
    );
    expect(signals[0]?.signal).toBe("banner-element");
  });

  it("geeft niets terug zonder banner-markers", () => {
    expect(detectBannerElement("<html><body>geen banner</body></html>")).toEqual([]);
  });
});

describe("detectConsentApi", () => {
  it("herkent IAB TCF (__tcfapi) en Google consent mode", () => {
    const signals = detectConsentApi(
      "window.__tcfapi = function(){}; window.googlefc = {};",
    );
    const ids = signals.map((s) => s.signal);
    expect(ids).toContain("consent-api:iab-tcf");
    expect(ids).toContain("consent-api:google-consent-mode");
  });

  it("geeft niets terug zonder consent-API", () => {
    expect(detectConsentApi("<html></html>")).toEqual([]);
  });
});

describe("extractFooterLinks", () => {
  it("haalt alleen http(s)-links uit de footer, resolved tegen baseUrl", () => {
    const links = extractFooterLinks(ONETRUST_HTML, "https://example.com");
    expect(links).toContainEqual({ text: "Privacybeleid", href: "https://example.com/privacy" });
    expect(links).toContainEqual({ text: "Algemene voorwaarden", href: "https://example.com/terms" });
    // mailto wordt overgeslagen
    expect(links.some((l) => l.href.startsWith("mailto:"))).toBe(false);
  });

  it("valt terug op de hele pagina als er geen <footer> is", () => {
    const html = '<a href="https://example.com/x">X</a><a href="#top">Anker</a>';
    const links = extractFooterLinks(html, "https://example.com");
    expect(links.map((l) => l.href)).toContain("https://example.com/x");
    expect(links.some((l) => l.href.includes("#top"))).toBe(false);
  });
});

describe("findPrivacyPolicyLink + findLegalLinks", () => {
  const links: FooterLink[] = [
    { text: "Privacybeleid", href: "https://example.com/privacy" },
    { text: "Algemene voorwaarden", href: "https://example.com/terms" },
    { text: "Contact", href: "https://example.com/contact" },
  ];

  it("vindt de privacy-policy-link op kernwoorden", () => {
    expect(findPrivacyPolicyLink(links)?.href).toBe("https://example.com/privacy");
  });

  it("vindt terms/imprint/contact-links", () => {
    const legal = findLegalLinks(links);
    expect(legal.terms?.href).toBe("https://example.com/terms");
    expect(legal.contact?.href).toBe("https://example.com/contact");
    expect(legal.imprint).toBeUndefined();
  });

  it("geeft null/leeg object zonder matchende links", () => {
    expect(findPrivacyPolicyLink([{ text: "Home", href: "https://example.com" }])).toBeNull();
    expect(findLegalLinks([{ text: "Home", href: "https://example.com" }])).toEqual({});
  });
});

describe("parseLastUpdated + parseContactEmail", () => {
  it("leest de last-updated-datum uit meta en tekstpatronen", () => {
    expect(
      parseLastUpdated('<meta name="dateModified" content="2026-03-01">'),
    ).toBe("2026-03-01");
    expect(
      parseLastUpdated('<time datetime="2026-03-01">1 maart 2026</time>'),
    ).toBe("2026-03-01");
    expect(parseLastUpdated("Last updated: 12 March 2026")).toBe("12 March 2026");
    expect(parseLastUpdated("Laatst bijgewerkt op 12 maart 2026")).toBe("12 maart 2026");
    expect(parseLastUpdated("<html></html>")).toBeNull();
  });

  it("vindt het eerste contact-e-mailadres", () => {
    expect(parseContactEmail("Contact: privacy@example.com of iets anders")).toBe(
      "privacy@example.com",
    );
    expect(parseContactEmail("<html></html>")).toBeNull();
  });
});

describe("detectGdprSignals", () => {
  it("herkent DSAR/data-verwijdering en IAB-TCF-signalen", () => {
    const signals = detectGdprSignals(
      "Right to access your data. __tcfapi is available. GDPR applies.",
    );
    const ids = signals.map((s) => s.signal);
    expect(ids).toContain("gdpr:dsar");
    expect(ids).toContain("gdpr:iab-tcf");
    expect(ids).toContain("gdpr:gdpr-references");
  });

  it("geeft niets terug zonder GDPR-signalen", () => {
    expect(detectGdprSignals("<html><body>Hello world</body></html>")).toEqual([]);
  });
});

describe("complianceEvidenceSchema", () => {
  it("valideert een signalen-lijst", () => {
    expect(
      complianceEvidenceSchema.safeParse({
        kind: "compliance",
        signals: [{ signal: "cmp:onetrust", detail: "OneTrust herkend." }],
      }).success,
    ).toBe(true);
    expect(
      complianceEvidenceSchema.safeParse({ kind: "compliance", signals: [] }).success,
    ).toBe(true);
  });

  it("weigert een ongeldige kind", () => {
    expect(
      complianceEvidenceSchema.safeParse({
        kind: "anders",
        signals: [],
      }).success,
    ).toBe(false);
  });

  it("bevat een disclaimer-tekst (geen juridische claims)", () => {
    expect(COMPLIANCE_DISCLAIMER.length).toBeGreaterThan(20);
    expect(COMPLIANCE_DISCLAIMER.toLowerCase()).toContain("geen juridisch advies");
  });
});