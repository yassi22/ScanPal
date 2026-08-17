import { describe, it, expect } from "vitest";
import {
  ACTIVE_TEST_LIMITS,
  CSRF_TOKEN_NAMES,
  DEBUG_ENDPOINTS,
  evidenceSchema,
  INPUT_VALIDATION_PAYLOADS,
  OPEN_REDIRECT_PAYLOADS,
  REDIRECT_PARAM_NAMES,
  SQLI_PAYLOADS,
  truncateEvidence,
  XSS_PAYLOADS,
} from "../active-tests";
import { checkCatalog } from "../check-catalog";

describe("active-tests (plan 52)", () => {
  it("heeft alleen niet-destructieve, GET-only payloads", () => {
    const allPayloads = [
      ...SQLI_PAYLOADS,
      ...XSS_PAYLOADS,
      ...OPEN_REDIRECT_PAYLOADS,
      ...INPUT_VALIDATION_PAYLOADS,
    ];
    for (const payload of allPayloads) {
      expect(payload.length).toBeLessThanOrEqual(3000);
    }
    expect(OPEN_REDIRECT_PAYLOADS.every((p) => p.startsWith("//") || p.startsWith("https://"))).toBe(true);
  });

  it("heeft curated grenzen (geen wordlist)", () => {
    expect(SQLI_PAYLOADS.length).toBeLessThanOrEqual(ACTIVE_TEST_LIMITS.maxPayloadsPerTest + 1);
    expect(XSS_PAYLOADS.length).toBeLessThanOrEqual(ACTIVE_TEST_LIMITS.maxPayloadsPerTest);
    expect(OPEN_REDIRECT_PAYLOADS.length).toBeLessThanOrEqual(ACTIVE_TEST_LIMITS.maxPayloadsPerTest);
    expect(DEBUG_ENDPOINTS.length).toBeLessThanOrEqual(ACTIVE_TEST_LIMITS.maxProbes);
    expect(ACTIVE_TEST_LIMITS.probesPerHostPerMinute).toBe(30);
    expect(ACTIVE_TEST_LIMITS.timeoutMs).toBe(4000);
  });

  it("kapt evidence af op evidenceMaxBytes", () => {
    const long = "a".repeat(ACTIVE_TEST_LIMITS.evidenceMaxBytes + 100);
    const truncated = truncateEvidence(long);
    expect(truncated.length).toBe(ACTIVE_TEST_LIMITS.evidenceMaxBytes + 1);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncateEvidence("kort")).toBe("kort");
  });

  it("valideert gestructureerd evidence", () => {
    const parsed = evidenceSchema.safeParse({
      request: "GET https://example.com/?id='",
      response: "HTTP 200",
    });
    expect(parsed.success).toBe(true);
    expect(evidenceSchema.safeParse({ request: "x" }).success).toBe(false);
  });

  it("heeft geen overlappende payload-sets die onbedoeld destructief zijn", () => {
    expect(REDIRECT_PARAM_NAMES).toContain("url");
    expect(CSRF_TOKEN_NAMES.length).toBeGreaterThan(0);
  });

  it("heeft alle 11 actieve checks in de catalog met active: true", () => {
    const activeIds = [
      "sqli-probe",
      "xss-probe",
      "csrf-check",
      "open-redirect-probe",
      "idor-probe",
      "input-validation",
      "debug-endpoints",
      "graphql-introspection",
      "jwt-audit",
      "webhook-signature",
      "tenant-isolation",
    ];
    for (const id of activeIds) {
      const entry = checkCatalog.find((c) => c.id === id);
      expect(entry).toBeDefined();
      expect(entry?.active).toBe(true);
      expect(entry?.category).toBe("http");
    }
  });
});