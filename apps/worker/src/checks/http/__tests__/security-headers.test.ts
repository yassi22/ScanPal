import { describe, it, expect, vi } from "vitest";
import {
  SECURITY_HEADER_CHECK_IDS,
  cspIssues,
  hstsIssues,
  xctoIssues,
  xfoIssues,
  referrerPolicyIssues,
  permissionsPolicyIssues,
  coopIssues,
  coepIssues,
  evaluateSecurityHeaders,
  securityHeadersCheck,
} from "../security-headers";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function headersOf(record: Record<string, string>): Headers {
  return new Headers(record);
}

describe("CSP-directive-splitser", () => {
  it("splitst directives en hun sources", () => {
    const d = cspIssues(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors https://example.com",
    );
    expect(d.some((i) => i.detail.includes("unsafe-inline"))).toBe(true);
  });

  it("flagt unsafe-inline/unsafe-eval en wildcards als medium", () => {
    const issues = cspIssues(
      "default-src *; script-src 'self' 'unsafe-eval'",
    );
    expect(issues.filter((i) => i.severity === "medium").length).toBeGreaterThan(0);
  });

  it("flagt een ontbrekende default-src als low", () => {
    const issues = cspIssues("script-src 'self'");
    expect(issues).toContainEqual({
      severity: "low",
      detail: "geen default-src ingesteld",
    });
  });

  it("geeft geen issues voor een strakke CSP", () => {
    expect(
      cspIssues("default-src 'self'; script-src 'self'; style-src 'self'"),
    ).toEqual([]);
  });
});

describe("HSTS-parse", () => {
  it("flagt een te korte max-age als medium", () => {
    expect(hstsIssues("max-age=600").some((i) => i.severity === "medium")).toBe(true);
  });

  it("flagt ontbrekende includeSubDomains als low", () => {
    expect(hstsIssues("max-age=31536000").some((i) => i.severity === "low")).toBe(true);
  });

  it("geeft geen issues bij een volledige configuratie", () => {
    expect(hstsIssues("max-age=31536000; includeSubDomains; preload")).toEqual([]);
  });
});

describe("per-header validatie", () => {
  it("xcto: alleen nosniff is goed", () => {
    expect(xctoIssues("nosniff")).toEqual([]);
    expect(xctoIssues("no-sniff").length).toBeGreaterThan(0);
  });

  it("xfo: DENY/SAMEORIGIN goed, ALLOW-FROM deprecated", () => {
    expect(xfoIssues("DENY")).toEqual([]);
    expect(xfoIssues("SAMEORIGIN")).toEqual([]);
    expect(xfoIssues("ALLOW-FROM https://example.com").length).toBeGreaterThan(0);
  });

  it("referrer-policy: unsafe-url is onveilig", () => {
    expect(referrerPolicyIssues("unsafe-url").length).toBeGreaterThan(0);
    expect(referrerPolicyIssues("strict-origin-when-cross-origin")).toEqual([]);
  });

  it("permissions-policy: wildcard op gevoelige features is low", () => {
    expect(permissionsPolicyIssues("camera=*, microphone=(self)")).toContainEqual({
      severity: "low",
      detail: "camera staat open voor alle origins (*)",
    });
    expect(permissionsPolicyIssues("camera=(self), geolocation=(self)")).toEqual([]);
  });

  it("coop: unsafe-none is zwak, same-origin is goed", () => {
    expect(coopIssues("unsafe-none").length).toBeGreaterThan(0);
    expect(coopIssues("same-origin")).toEqual([]);
  });

  it("coep: require-corp/credentialless is goed, anders low", () => {
    expect(coepIssues("require-corp")).toEqual([]);
    expect(coepIssues("credentialless")).toEqual([]);
    expect(coepIssues("unsafe-none")[0].severity).toBe("low");
  });
});

describe("evaluateSecurityHeaders", () => {
  it("produceert acht checks (fan-out) uit één headers-object", () => {
    const results = evaluateSecurityHeaders(headersOf({}));
    expect(results).toHaveLength(SECURITY_HEADER_CHECK_IDS.length);
    expect(results.map((r) => r.id)).toEqual([...SECURITY_HEADER_CHECK_IDS]);
  });

  it("geeft fail (high) bij ontbrekende CSP/HSTS en warn bij de rest", () => {
    const results = evaluateSecurityHeaders(headersOf({}));
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("security-header-csp")?.status).toBe("fail");
    expect(byId.get("security-header-hsts")?.status).toBe("fail");
    expect(byId.get("security-header-xcto")?.status).toBe("warn");
    expect(byId.get("security-header-xfo")?.status).toBe("warn");
    expect(byId.get("security-header-referrer-policy")?.status).toBe("warn");
    expect(byId.get("security-header-permissions-policy")?.status).toBe("warn");
    expect(byId.get("security-header-coop")?.status).toBe("warn");
    expect(byId.get("security-header-coep")?.status).toBe("warn");
    expect(byId.get("security-header-coep")?.severity).toBe("low");
  });

  it("geeft pass bij een volledig correcte configuratie", () => {
    const results = evaluateSecurityHeaders(
      headersOf({
        "content-security-policy": "default-src 'self'; script-src 'self'",
        "strict-transport-security": "max-age=31536000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(self), microphone=(self), geolocation=(self)",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
      }),
    );
    for (const result of results) {
      expect(result.status).toBe("pass");
    }
  });

  it("zet evidence op de header-waarde bij warn/fail", () => {
    const results = evaluateSecurityHeaders(
      headersOf({
        "content-security-policy": "default-src *",
        "strict-transport-security": "max-age=600",
        "x-frame-options": "ALLOW-FROM https://example.com",
      }),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("security-header-csp")?.evidence).toBe("default-src *");
    expect(byId.get("security-header-hsts")?.evidence).toBe("max-age=600");
    expect(byId.get("security-header-xfo")?.evidence).toBe("ALLOW-FROM https://example.com");
  });

  it("beschouwt CSP frame-ancestors als vervanger voor XFO (info)", () => {
    const results = evaluateSecurityHeaders(
      headersOf({
        "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
      }),
    );
    const xfo = results.find((r) => r.id === "security-header-xfo");
    expect(xfo?.status).toBe("info");
    expect(xfo?.detail).toContain("frame-ancestors");
  });
});

describe("securityHeadersCheck.run", () => {
  it("verwerkt één fetchPage-response naar acht findings", async () => {
    mockedFetchPage.mockResolvedValueOnce(
      new Response(null, {
        headers: { "strict-transport-security": "max-age=31536000; includeSubDomains" },
      }),
    );
    const results = await securityHeadersCheck.run({
      url: "https://example.com",
      scanId: "scan-1",
      activeTests: false,
      rateLimit: {} as never,
    });
    expect(mockedFetchPage).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(SECURITY_HEADER_CHECK_IDS.length);
  });

  it("geeft acht info-findings als de pagina niet bereikbaar is", async () => {
    mockedFetchPage.mockRejectedValueOnce(new Error("timeout"));
    const results = await securityHeadersCheck.run({
      url: "https://example.com",
      scanId: "scan-1",
      activeTests: false,
      rateLimit: {} as never,
    });
    expect(results).toHaveLength(SECURITY_HEADER_CHECK_IDS.length);
    for (const result of results) {
      expect(result.status).toBe("info");
      expect(result.detail).toContain("niet controleerbaar");
    }
  });
});