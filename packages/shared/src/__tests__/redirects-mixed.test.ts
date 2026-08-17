import { describe, it, expect } from "vitest";
import {
  analyzeRedirect,
  evaluateRedirectsMixed,
  findMixedContent,
  redirectsMixedEvidence,
  isHttps,
} from "../redirects-mixed";

describe("redirects-mixed", () => {
  it("isHttps detecteert https", () => {
    expect(isHttps("https://x.com/")).toBe(true);
    expect(isHttps("http://x.com/")).toBe(false);
  });

  it("findMixedContent vindt http://-resources op https-pagina", () => {
    const html = `
      <script src="http://cdn.example.com/lib.js"></script>
      <img src="https://safe.example.com/img.png">
      <img src="http://insecure.example.com/img2.png">
      <link href="https://safe.example.com/style.css">
    `;
    const items = findMixedContent(html, "https://site.example/page");
    expect(items.length).toBe(2);
    expect(items[0].tag).toBe("script");
    expect(items[1].tag).toBe("img");
  });

  it("findMixedContent levert niets op http-pagina", () => {
    const items = findMixedContent(
      `<script src="http://x.com/a.js"></script>`,
      "http://site.example/",
    );
    expect(items).toEqual([]);
  });

  it("analyzeRedirect detecteert http→https upgrade", () => {
    const a = analyzeRedirect("http://x.com/", "https://x.com/");
    expect(a.redirected).toBe(true);
    expect(a.httpsUpgraded).toBe(true);
  });

  it("evaluateRedirectsMixed: pass bij https-upgrade zonder mixed content", () => {
    const a = analyzeRedirect("http://x.com/", "https://x.com/");
    const { status, detail } = evaluateRedirectsMixed(a, []);
    expect(status).toBe("pass");
    expect(detail).toContain("HTTPS");
  });

  it("evaluateRedirectsMixed: fail bij mixed content", () => {
    const a = analyzeRedirect("https://x.com/", "https://x.com/");
    const { status } = evaluateRedirectsMixed(a, [
      { tag: "script", attr: "src", url: "http://cdn.example.com/a.js" },
    ]);
    expect(status).toBe("fail");
  });

  it("evaluateRedirectsMixed: warn als final URL niet https", () => {
    const a = analyzeRedirect("http://x.com/", "http://x.com/");
    const { status } = evaluateRedirectsMixed(a, []);
    expect(status).toBe("warn");
  });

  it("redirectsMixedEvidence bouwt evidence-object", () => {
    const a = analyzeRedirect("http://x.com/", "https://x.com/");
    const ev = redirectsMixedEvidence(a, [], ["http://x.com/", "https://x.com/"]);
    expect(ev.kind).toBe("redirects-mixed");
    expect(ev.https_upgraded).toBe(true);
    expect(ev.redirect_chain).toEqual(["http://x.com/", "https://x.com/"]);
  });
});
