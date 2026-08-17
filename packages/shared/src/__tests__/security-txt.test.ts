import { describe, it, expect } from "vitest";
import {
  analyzeNotFoundPage,
  evaluateSecurityTxt,
  parseSecurityTxt,
  securityTxtEvidence,
} from "../security-txt";

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();

describe("parseSecurityTxt", () => {
  it("parseert geldige security.txt met alle verplichte velden", () => {
    const text = `Contact: mailto:security@example.com\nExpires: ${FUTURE}\nCanonical: https://example.com/.well-known/security.txt`;
    const fields = parseSecurityTxt(text);
    expect(fields.present).toBe(true);
    expect(fields.contact).toBe("mailto:security@example.com");
    expect(fields.expires).toBe(FUTURE);
    expect(fields.expired).toBe(false);
    expect(fields.missingRequired).toEqual([]);
  });

  it("markeert ontbrekende verplichte velden", () => {
    const fields = parseSecurityTxt("Canonical: https://x.com/security.txt");
    expect(fields.missingRequired).toContain("Contact");
    expect(fields.missingRequired).toContain("Expires");
  });

  it("detecteert verlopen Expires", () => {
    const fields = parseSecurityTxt(`Contact: mailto:x@example.com\nExpires: ${PAST}`);
    expect(fields.expired).toBe(true);
  });

  it("levert not-present bij null", () => {
    const fields = parseSecurityTxt(null);
    expect(fields.present).toBe(false);
    expect(fields.missingRequired).toContain("Contact");
  });
});

describe("analyzeNotFoundPage", () => {
  it("herkent custom 404-pagina met h1 en search", () => {
    const html = `<html><body><h1>Pagina niet gevonden</h1><form role="search"><input type="search"></form><a href="/">Home</a></body></html>`;
    const result = analyzeNotFoundPage(html, 404);
    expect(result.is404).toBe(true);
    expect(result.hasH1).toBe(true);
    expect(result.hasSearch).toBe(true);
    expect(result.hasHomeLink).toBe(true);
    expect(result.looksCustom).toBe(true);
  });

  it("markeert niet-404 status", () => {
    const result = analyzeNotFoundPage("<html>home</html>", 200);
    expect(result.is404).toBe(false);
  });
});

describe("evaluateSecurityTxt", () => {
  it("pass bij volledig geldige setup", () => {
    const sec = parseSecurityTxt(`Contact: mailto:x@example.com\nExpires: ${FUTURE}`);
    const favicon = { present: true, status: 200 };
    const nf = analyzeNotFoundPage(
      `<html><body><h1>404</h1></body></html>`,
      404,
    );
    const { status, detail } = evaluateSecurityTxt(sec, favicon, nf);
    expect(status).toBe("pass");
    expect(detail).toContain("security.txt");
  });

  it("fail als verplichte velden ontbreken", () => {
    const sec = parseSecurityTxt(null);
    const favicon = { present: true, status: 200 };
    const nf = analyzeNotFoundPage("<html></html>", 404);
    const { status } = evaluateSecurityTxt(sec, favicon, nf);
    expect(status).toBe("fail");
  });

  it("warn bij ontbrekend favicon", () => {
    const sec = parseSecurityTxt(`Contact: mailto:x@example.com\nExpires: ${FUTURE}`);
    const favicon = { present: false, status: 404 };
    const nf = analyzeNotFoundPage(`<html><body><h1>404</h1></body></html>`, 404);
    const { status, detail } = evaluateSecurityTxt(sec, favicon, nf);
    expect(status).toBe("warn");
    expect(detail).toContain("favicon");
  });

  it("securityTxtEvidence bouwt evidence-object", () => {
    const sec = parseSecurityTxt(`Contact: mailto:x@example.com\nExpires: ${FUTURE}`);
    const favicon = { present: true, status: 200 };
    const nf = analyzeNotFoundPage(`<html><body><h1>404</h1></body></html>`, 404);
    const ev = securityTxtEvidence(sec, favicon, nf);
    expect(ev.kind).toBe("security-txt");
    expect(ev.security_txt.present).toBe(true);
    expect(ev.favicon.present).toBe(true);
    expect(ev.not_found_page.is_404).toBe(true);
  });
});
