import { describe, it, expect } from "vitest";
import {
  evaluateHostingFingerprint,
  fingerprintHosting,
  hostingFingerprintEvidence,
  type HostingPlatform,
} from "../hosting-fingerprint";
import type { HeaderSource } from "../stack-detection";

function headersFrom(map: Record<string, string>): HeaderSource {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("fingerprintHosting — platformdetectie", () => {
  it("herkent Vercel uit x-vercel-id", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-vercel-id": "iad1::abc", server: "Vercel" }),
      "https://example.com/",
    );
    expect(fp.platform).toBe<HostingPlatform>("vercel");
    expect(fp.evidence_headers["x-vercel-id"]).toBe("iad1::abc");
    expect(fp.signals).toEqual([]);
  });

  it("herkent Netlify uit x-nf-request-id", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-nf-request-id": "123", server: "Netlify" }),
      "https://example.com/",
    );
    expect(fp.platform).toBe<HostingPlatform>("netlify");
  });

  it("herkent Cloudflare uit cf-ray", () => {
    const fp = fingerprintHosting(
      headersFrom({ "cf-ray": "abc", server: "cloudflare" }),
      "https://example.com/",
    );
    expect(fp.platform).toBe<HostingPlatform>("cloudflare");
  });

  it("herkent Fastly uit x-served-by", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-served-by": "cache-ams", "x-timer": "t=1" }),
      "https://example.com/",
    );
    expect(fp.platform).toBe<HostingPlatform>("fastly");
  });

  it("herkent CloudFront uit x-amz-cf-id", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-amz-cf-id": "xyz" }),
      "https://example.com/",
    );
    expect(fp.platform).toBe<HostingPlatform>("cloudfront");
  });

  it("herkent GitHub Pages uit server", () => {
    const fp = fingerprintHosting(
      headersFrom({ server: "GitHub.com" }),
      "https://example.github.io/",
    );
    expect(fp.platform).toBe<HostingPlatform>("github-pages");
  });

  it("degradeert naar unknown zonder platform-headers", () => {
    const fp = fingerprintHosting(
      headersFrom({ server: "nginx/1.25" }),
      "https://example.com/",
    );
    expect(fp.platform).toBe<HostingPlatform>("unknown");
    const { status, detail } = evaluateHostingFingerprint(fp);
    expect(status).toBe("info");
    expect(detail).toContain("nginx");
  });
});

describe("fingerprintHosting — signalen", () => {
  it("cache-hygiëne: public + sessie-cookie → medium", () => {
    const fp = fingerprintHosting(
      headersFrom({
        "x-vercel-id": "iad1",
        "cache-control": "public, max-age=60",
        "set-cookie": "session=abc; HttpOnly",
      }),
      "https://example.com/",
    );
    const cache = fp.signals.find((s) => s.signal === "cache-hygiene");
    expect(cache).toBeDefined();
    expect(cache?.severity).toBe("medium");
    const { status, severity } = evaluateHostingFingerprint(fp);
    expect(status).toBe("warn");
    expect(severity).toBe("medium");
  });

  it("cache-hygiëne: public zonder auth-cookie → geen signaal (statische site)", () => {
    const fp = fingerprintHosting(
      headersFrom({
        "x-vercel-id": "iad1",
        "cache-control": "public, max-age=600",
      }),
      "https://example.com/",
    );
    expect(fp.signals.find((s) => s.signal === "cache-hygiene")).toBeUndefined();
    expect(evaluateHostingFingerprint(fp).status).toBe("pass");
  });

  it("cache-hygiëne: private override → geen signaal", () => {
    const fp = fingerprintHosting(
      headersFrom({
        "x-vercel-id": "iad1",
        "cache-control": "public, private",
        "set-cookie": "session=abc",
      }),
      "https://example.com/",
    );
    expect(fp.signals.find((s) => s.signal === "cache-hygiene")).toBeUndefined();
  });

  it("cache-hygiëne: cookie-waarde bevat 'token' maar naam niet → geen signaal (geen false positive)", () => {
    const fp = fingerprintHosting(
      headersFrom({
        "x-vercel-id": "iad1",
        "cache-control": "public, max-age=60",
        "set-cookie": "prefs=token-like-value; Path=/",
      }),
      "https://example.com/",
    );
    expect(fp.signals.find((s) => s.signal === "cache-hygiene")).toBeUndefined();
  });

  it("cache-hygiëne: cookie-naam 'connect.sid' → signaal (Express-sessie)", () => {
    const fp = fingerprintHosting(
      headersFrom({
        "x-vercel-id": "iad1",
        "cache-control": "public, max-age=60",
        "set-cookie": "connect.sid=s%3Aabc; HttpOnly; Path=/",
      }),
      "https://example.com/",
    );
    expect(fp.signals.find((s) => s.signal === "cache-hygiene")).toBeDefined();
  });

  it("origin-lek: cf-ray + server nginx → low-signaal", () => {
    const fp = fingerprintHosting(
      headersFrom({ "cf-ray": "abc", server: "nginx/1.25" }),
      "https://example.com/",
    );
    const leak = fp.signals.find((s) => s.signal === "origin-leak");
    expect(leak).toBeDefined();
    expect(leak?.severity).toBe("low");
    expect(evaluateHostingFingerprint(fp).status).toBe("warn");
  });

  it("origin-lek: cf-ray + server cloudflare → geen signaal", () => {
    const fp = fingerprintHosting(
      headersFrom({ "cf-ray": "abc", server: "cloudflare" }),
      "https://example.com/",
    );
    expect(fp.signals.find((s) => s.signal === "origin-leak")).toBeUndefined();
    expect(evaluateHostingFingerprint(fp).status).toBe("pass");
  });

  it("preview-URL: Vercel git-deploy → low-signaal", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-vercel-id": "iad1" }),
      "https://myapp-git-main-abc.vercel.app/",
    );
    const preview = fp.signals.find((s) => s.signal === "preview-url");
    expect(preview).toBeDefined();
    expect(preview?.severity).toBe("low");
  });

  it("preview-URL: Netlify branch-deploy → info-signaal", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-nf-request-id": "123" }),
      "https://feature--mysite.netlify.app/",
    );
    expect(fp.signals.find((s) => s.signal === "preview-url")).toBeDefined();
  });

  it("preview-URL: productie-URL → geen signaal", () => {
    const fp = fingerprintHosting(
      headersFrom({ "x-vercel-id": "iad1" }),
      "https://example.com/",
    );
    expect(fp.signals.find((s) => s.signal === "preview-url")).toBeUndefined();
  });
});

describe("hostingFingerprintEvidence", () => {
  it("produceert evidence met kind + platform + signalen", () => {
    const fp = fingerprintHosting(
      headersFrom({ "cf-ray": "abc", server: "nginx" }),
      "https://example.com/",
    );
    const evidence = hostingFingerprintEvidence(fp);
    expect(evidence.kind).toBe("hosting-fingerprint");
    expect(evidence.platform).toBe("cloudflare");
    expect(evidence.signals.length).toBe(1);
    expect(evidence.evidence_headers["cf-ray"]).toBe("abc");
  });
});
