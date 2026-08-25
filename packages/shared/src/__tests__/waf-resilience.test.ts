import { describe, it, expect } from "vitest";
import {
  detectWafCdn,
  evaluateWafResilience,
  inspectRateLimitHeaders,
  wafResilienceEvidence,
  type RateLimitHeaders,
  type WafCdnFingerprint,
} from "../waf-resilience";

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

const noRateLimit: RateLimitHeaders = { headers_found: [], retry_after: null };

describe("detectWafCdn", () => {
  it("herkent Cloudflare via cf-ray", () => {
    const fp = detectWafCdn(headers({ "cf-ray": "abc123" }));
    expect(fp.cdn).toBe("Cloudflare");
    expect(fp.waf).toBeNull();
    expect(fp.signals).toContain("cf-ray");
  });

  it("herkent Cloudflare via server-header", () => {
    const fp = detectWafCdn(headers({ server: "cloudflare" }));
    expect(fp.cdn).toBe("Cloudflare");
  });

  it("herkent AWS WAF + CloudFront samen", () => {
    const fp = detectWafCdn(headers({
      "x-aws-waf-token": "token",
      "x-amz-cf-id": "id",
    }));
    expect(fp.waf).toBe("AWS WAF");
    expect(fp.cdn).toBe("AWS CloudFront");
  });

  it("herkent Sucuri als WAF", () => {
    const fp = detectWafCdn(headers({ "x-sucuri-id": "0a0a0a0a" }));
    expect(fp.waf).toBe("Sucuri");
    expect(fp.cdn).toBeNull();
  });

  it("herkent generieke x-cdn", () => {
    const fp = detectWafCdn(headers({ "x-cdn": "akamai" }));
    expect(fp.cdn).toBe("CDN");
  });

  it("null bij geen bekende headers", () => {
    const fp = detectWafCdn(headers({ "content-type": "text/html" }));
    expect(fp.waf).toBeNull();
    expect(fp.cdn).toBeNull();
    expect(fp.signals).toEqual([]);
  });

  it("server-substring match respecteert contains", () => {
    const fp = detectWafCdn(headers({ server: "nginx" }));
    expect(fp.cdn).toBeNull();
    expect(fp.waf).toBeNull();
  });

  it("x-cache telt niet als WAF/CDN-bescherming (informatief signaal)", () => {
    const fp = detectWafCdn(headers({ "x-cache": "HIT" }));
    expect(fp.waf).toBeNull();
    expect(fp.cdn).toBeNull();
    // signaal blijft wel geregistreerd voor de evidence
    expect(fp.signals).toContain("x-cache");
  });

  it("x-amzn-trace-id (ALB/API-Gateway) telt niet als bescherming", () => {
    const fp = detectWafCdn(headers({ "x-amzn-trace-id": "Root=1-x" }));
    expect(fp.waf).toBeNull();
    expect(fp.cdn).toBeNull();
    expect(fp.signals).toContain("x-amzn-trace-id");
  });

  it("een site achter alleen een cache blijft warn (geen valse bescherming)", () => {
    const fp = detectWafCdn(headers({ "x-cache": "MISS" }));
    const r = evaluateWafResilience(fp, noRateLimit, false);
    expect(r.status).toBe("warn");
    expect(r.severity).toBe("low");
  });
});

describe("inspectRateLimitHeaders", () => {
  it("verzamelt aanwezige rate-limit-headers + retry-after", () => {
    const rl = inspectRateLimitHeaders(headers({
      "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "42",
      "x-ratelimit-reset": "1700000000",
      "retry-after": "30",
    }));
    expect(rl.headers_found).toContain("x-ratelimit-limit");
    expect(rl.headers_found).toContain("x-ratelimit-remaining");
    expect(rl.headers_found).toContain("x-ratelimit-reset");
    expect(rl.retry_after).toBe("30");
  });

  it("herkent ratelimit-* zonder koppelteken", () => {
    const rl = inspectRateLimitHeaders(headers({
      "ratelimit-remaining": "5",
    }));
    expect(rl.headers_found).toContain("ratelimit-remaining");
    expect(rl.retry_after).toBeNull();
  });

  it("leeg bij geen rate-limit-headers", () => {
    const rl = inspectRateLimitHeaders(headers({ "content-type": "text/html" }));
    expect(rl.headers_found).toEqual([]);
    expect(rl.retry_after).toBeNull();
  });
});

describe("evaluateWafResilience", () => {
  it("info bij WAF/CDN + rate-limit-headers", () => {
    const fp: WafCdnFingerprint = { waf: "Cloudflare", cdn: null, signals: ["cf-ray"] };
    const rl: RateLimitHeaders = {
      headers_found: ["x-ratelimit-remaining"],
      retry_after: null,
    };
    const r = evaluateWafResilience(fp, rl, false);
    expect(r.status).toBe("info");
    expect(r.detail).toContain("Cloudflare");
    expect(r.detail).toContain("rate-limit-headers");
  });

  it("info bij alleen WAF/CDN (geen rate-limit-headers)", () => {
    const fp: WafCdnFingerprint = { waf: null, cdn: "Cloudflare", signals: ["cf-ray"] };
    const r = evaluateWafResilience(fp, noRateLimit, false);
    expect(r.status).toBe("info");
    expect(r.detail).toContain("Cloudflare");
  });

  it("info bij alleen rate-limit-headers (geen WAF/CDN)", () => {
    const fp: WafCdnFingerprint = { waf: null, cdn: null, signals: [] };
    const rl: RateLimitHeaders = {
      headers_found: ["x-ratelimit-remaining"],
      retry_after: null,
    };
    const r = evaluateWafResilience(fp, rl, false);
    expect(r.status).toBe("info");
    expect(r.detail).toContain("Rate-limit-headers");
  });

  it("warn/low bij geen WAF/CDN en geen rate-limit-headers", () => {
    const fp: WafCdnFingerprint = { waf: null, cdn: null, signals: [] };
    const r = evaluateWafResilience(fp, noRateLimit, false);
    expect(r.status).toBe("warn");
    expect(r.severity).toBe("low");
    expect(r.detail).toContain("Geen WAF/CDN");
  });

  it("info bij 429 op de bestaande fetch", () => {
    const fp: WafCdnFingerprint = { waf: null, cdn: null, signals: [] };
    const r = evaluateWafResilience(fp, noRateLimit, true);
    expect(r.status).toBe("info");
    expect(r.detail).toContain("429");
  });
});

describe("wafResilienceEvidence", () => {
  it("bevat kind + velden", () => {
    const fp: WafCdnFingerprint = { waf: "Cloudflare", cdn: null, signals: ["cf-ray"] };
    const rl: RateLimitHeaders = {
      headers_found: ["x-ratelimit-remaining"],
      retry_after: "10",
    };
    const ev = wafResilienceEvidence(fp, rl, false);
    expect(ev.kind).toBe("waf-resilience");
    expect(ev.waf).toBe("Cloudflare");
    expect(ev.rate_limit_headers).toContain("x-ratelimit-remaining");
    expect(ev.retry_after).toBe("10");
    expect(ev.status_429).toBe(false);
  });
});
