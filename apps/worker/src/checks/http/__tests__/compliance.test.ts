import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  COMPLIANCE_CHECK_IDS,
  complianceCheck,
} from "../compliance";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function okRateLimit() {
  return vi.fn().mockResolvedValue({ ok: true });
}

function ctx(rateLimit = okRateLimit()) {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: rateLimit as never,
  };
}

function homeHtml(footer = "", head = ""): string {
  return `<!doctype html><html><head>${head}</head><body><main>Welkom</main><footer>${footer}</footer></body></html>`;
}

const PRIVACY_HTML = `<html><head>
  <meta name="dateModified" content="2026-03-01">
</head><body>
  <p>Last updated: 1 March 2026</p>
  <p>Contact: privacy@example.com</p>
</body></html>`;

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("complianceCheck.run (plan 61)", () => {
  it("produceert alle vijf compliance-check-ids", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(new Response(homeHtml(), { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(PRIVACY_HTML, { headers: { "content-type": "text/html" } }));

    const results = await complianceCheck.run(ctx());
    expect(results.map((r) => r.id)).toEqual([...COMPLIANCE_CHECK_IDS]);
  });

  it("herkent een bekende CMP en consent-API als pass", async () => {
    const head =
      '<script src="https://cdn.cookielaw.org/consent/123/otSDKStub.js"></script><script>window.__tcfapi=function(){};</script>';
    const html = homeHtml(
      '<a href="/privacy">Privacybeleid</a><a href="/contact">Contact</a>',
      head,
    );
    mockedFetchPage
      .mockResolvedValueOnce(new Response(html, { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(PRIVACY_HTML, { headers: { "content-type": "text/html" } }));

    const results = await complianceCheck.run(ctx());
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-banner")?.status).toBe("pass");
    expect(byId.get("consent-api")?.status).toBe("pass");
    expect(byId.get("gdpr-signals")?.status).toBe("pass");
  });

  it("signaleert het ontbreken van banner/consent/GDPR-signalen als warn", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(new Response(homeHtml(), { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(PRIVACY_HTML, { headers: { "content-type": "text/html" } }));

    const results = await complianceCheck.run(ctx());
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-banner")?.status).toBe("warn");
    expect(byId.get("consent-api")?.status).toBe("warn");
    expect(byId.get("gdpr-signals")?.status).toBe("warn");
  });

  it("vindt de privacy-policy-link in de footer en parset last-updated + e-mail", async () => {
    const html = homeHtml(
      '<a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms</a><a href="/imprint">Imprint</a><a href="/contact">Contact</a>',
    );
    mockedFetchPage
      .mockResolvedValueOnce(new Response(html, { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(PRIVACY_HTML, { headers: { "content-type": "text/html" } }));

    const results = await complianceCheck.run(ctx());
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("privacy-policy")?.status).toBe("pass");
    const evidence = byId.get("privacy-policy")?.evidence;
    expect(evidence).toMatchObject({
      kind: "compliance",
      signals: expect.arrayContaining([
        expect.objectContaining({ signal: "privacy-policy-link" }),
        expect.objectContaining({ signal: "last-updated" }),
        expect.objectContaining({ signal: "contact-email" }),
      ]),
    });
    expect(byId.get("legal-pages")?.status).toBe("pass");
  });

  it("meldt een onbereikbare privacy-policy als fail/high", async () => {
    const html = homeHtml('<a href="/privacy">Privacybeleid</a>');
    mockedFetchPage
      .mockResolvedValueOnce(new Response(html, { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    const results = await complianceCheck.run(ctx());
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("privacy-policy")?.status).toBe("fail");
  });

  it("levert vijf warn-findings als de homepage niet controleerbaar is", async () => {
    mockedFetchPage.mockRejectedValueOnce(new Error("timeout"));

    const results = await complianceCheck.run(ctx());
    expect(results).toHaveLength(COMPLIANCE_CHECK_IDS.length);
    for (const r of results) {
      expect(r.status).toBe("warn");
      expect(r.detail).toContain("niet controleerbaar");
    }
  });

  it("bevat per finding structured compliance-evidence (signalen)", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(new Response(homeHtml(), { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(PRIVACY_HTML, { headers: { "content-type": "text/html" } }));

    const results = await complianceCheck.run(ctx());
    for (const r of results) {
      expect(r.evidence).toMatchObject({ kind: "compliance" });
    }
  });
});