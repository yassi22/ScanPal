import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HMAC_TIMESTAMP_TOLERANCE_SECONDS,
  canonicalQueryString,
  canonicalRequestString,
  deriveHmacSigningSecret,
  isTimestampValid,
  parseHmacAuth,
  requestBodyHash,
  sha256Hex,
  signHmacRequest,
  verifyHmacSignature,
} from "@/lib/api-hmac";

const SECRET = "abc123secret";
const CANONICAL = "GET\n/api/scans\n\n1700000000\ne3b0c44298fc1c149afbf4c8996fb924";

describe("api-hmac (feature 25)", () => {
  beforeEach(() => {
    vi.stubEnv("API_HMAC_SIGNING_SECRET", "test-derivation-domain");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("canonicalRequestString", () => {
    it("bouwt METHOD\\nPATH\\nQUERY\\nTIMESTAMP\\nBODY_HASH", () => {
      expect(
        canonicalRequestString("get", "/api/scans", "", "1700000000", "hash123"),
      ).toBe("GET\n/api/scans\n\n1700000000\nhash123");
    });

    it("uppercase-t de method", () => {
      expect(canonicalRequestString("post", "/x", "", "1", "h")).toBe(
        "POST\n/x\n\n1\nh",
      );
    });
  });

  describe("canonicalQueryString", () => {
    it("sorteert paren en stript de leading `?`", () => {
      expect(canonicalQueryString("?b=2&a=1")).toBe("a=1&b=2");
      expect(canonicalQueryString("")).toBe("");
      expect(canonicalQueryString("?site_id=abc&page=2")).toBe("page=2&site_id=abc");
    });
  });

  describe("deriveHmacSigningSecret", () => {
    it("is deterministisch maar ≠ key_hash (pass-the-hash fix)", () => {
      const keyHash = sha256Hex("sp_live_secretfullkey");
      const secret = deriveHmacSigningSecret(keyHash);
      expect(secret).not.toBe(keyHash);
      expect(deriveHmacSigningSecret(keyHash)).toBe(secret);
      expect(deriveHmacSigningSecret(sha256Hex("ander"))).not.toBe(secret);
    });

    it("throwt als API_HMAC_SIGNING_SECRET ontbreekt (fail-closed)", () => {
      vi.stubEnv("API_HMAC_SIGNING_SECRET", "");
      expect(() => deriveHmacSigningSecret("anyhash")).toThrow();
    });
  });

  describe("sha256Hex", () => {
    it("lege string → bekende sha256", () => {
      expect(sha256Hex("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });
  });

  describe("signHmacRequest + verifyHmacSignature", () => {
    it("een geldige signature verifieert", () => {
      const sig = signHmacRequest(SECRET, CANONICAL);
      expect(verifyHmacSignature(SECRET, CANONICAL, sig)).toBe(true);
    });

    it("een verkeerd secret wijst af", () => {
      const sig = signHmacRequest(SECRET, CANONICAL);
      expect(verifyHmacSignature("wrong-secret", CANONICAL, sig)).toBe(false);
    });

    it("een gewijzigde canonieke string wijst af", () => {
      const sig = signHmacRequest(SECRET, CANONICAL);
      expect(verifyHmacSignature(SECRET, "POST\n/x\n1\nh", sig)).toBe(false);
    });

    it("getamperde signature (laatste char geflipt) → false", () => {
      const sig = signHmacRequest(SECRET, CANONICAL);
      const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
      expect(verifyHmacSignature(SECRET, CANONICAL, tampered)).toBe(false);
    });

    it("niet-hex signature → false (geen crash)", () => {
      expect(verifyHmacSignature(SECRET, CANONICAL, "nothex")).toBe(false);
    });
  });

  describe("parseHmacAuth", () => {
    it("parse `HMAC sp_live_...` → keyPrefix", () => {
      expect(parseHmacAuth("HMAC sp_live_abcDEF123")).toEqual({
        keyPrefix: "sp_live_abcDEF123",
      });
    });

    it("case-insensitive scheme", () => {
      expect(parseHmacAuth("hmac sp_live_xyz")).toEqual({
        keyPrefix: "sp_live_xyz",
      });
    });

    it("bearer-header → null", () => {
      expect(parseHmacAuth("Bearer sp_live_abc")).toBeNull();
    });

    it("null → null", () => {
      expect(parseHmacAuth(null)).toBeNull();
    });

    it("prefix zonder sp_live_ → null", () => {
      expect(parseHmacAuth("HMAC abc123")).toBeNull();
    });
  });

  describe("isTimestampValid", () => {
    it("timestamp binnen tolerantie → true", () => {
      const now = new Date(1700000000 * 1000);
      expect(isTimestampValid("1700000000", now)).toBe(true);
    });

    it("timestamp ver in het verleden → false", () => {
      const now = new Date(1700000000 * 1000);
      expect(
        isTimestampValid(
          String(1700000000 - HMAC_TIMESTAMP_TOLERANCE_SECONDS - 1),
          now,
        ),
      ).toBe(false);
    });

    it("timestamp ver in de toekomst → false", () => {
      const now = new Date(1700000000 * 1000);
      expect(
        isTimestampValid(
          String(1700000000 + HMAC_TIMESTAMP_TOLERANCE_SECONDS + 1),
          now,
        ),
      ).toBe(false);
    });

    it("niet-numerieke timestamp → false", () => {
      expect(isTimestampValid("not-a-number")).toBe(false);
    });
  });

  describe("requestBodyHash", () => {
    it("GET → sha256 van lege string", async () => {
      const req = new Request("http://localhost/api/scans", { method: "GET" });
      expect(await requestBodyHash(req)).toBe(sha256Hex(""));
    });

    it("DELETE → sha256 van lege string", async () => {
      const req = new Request("http://localhost/api/scans/1", {
        method: "DELETE",
      });
      expect(await requestBodyHash(req)).toBe(sha256Hex(""));
    });

    it("POST → sha256 van de body", async () => {
      const body = JSON.stringify({ url: "https://example.com" });
      const req = new Request("http://localhost/api/scans", {
        method: "POST",
        body,
      });
      expect(await requestBodyHash(req)).toBe(sha256Hex(body));
    });

    it("POST — originel request body blijft leesbaar na clone", async () => {
      const body = JSON.stringify({ url: "https://example.com" });
      const req = new Request("http://localhost/api/scans", {
        method: "POST",
        body,
      });
      await requestBodyHash(req);
      expect(await req.text()).toBe(body);
    });
  });
});
