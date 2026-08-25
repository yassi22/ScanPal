import { describe, it, expect } from "vitest";
import {
  AUTH_FLOW_CHECK_IDS,
  ENUMERATION_TIMING_THRESHOLD_MS,
  detectSessionRotation,
  detectUserEnumeration,
  isSessionCookie,
  passwordAutocompleteOk,
  sessionCookieIssues,
  type AuthProbeResponse,
  type AuthSessionCookie,
} from "../auth-flow";

function probe(status: number, body: string, duration_ms: number): AuthProbeResponse {
  return { status, body, duration_ms };
}

describe("passwordAutocompleteOk", () => {
  it("accepteert current-password op login", () => {
    expect(passwordAutocompleteOk("current-password", "login")).toBe(true);
  });
  it("accepteert new-password op signup/reset", () => {
    expect(passwordAutocompleteOk("new-password", "signup")).toBe(true);
    expect(passwordAutocompleteOk("new-password", "reset")).toBe(true);
  });
  it("verwerpt new-password op login en current-password op signup", () => {
    expect(passwordAutocompleteOk("new-password", "login")).toBe(false);
    expect(passwordAutocompleteOk("current-password", "signup")).toBe(false);
  });
  it("verwerpt null, off en username", () => {
    expect(passwordAutocompleteOk(null, "login")).toBe(false);
    expect(passwordAutocompleteOk("off", "login")).toBe(false);
    expect(passwordAutocompleteOk("username", "login")).toBe(false);
  });
  it("is hoofdletterongevoelig en trimt whitespace", () => {
    expect(passwordAutocompleteOk("  Current-Password ", "login")).toBe(true);
  });
});

describe("detectUserEnumeration", () => {
  it("detecteert verschillende status", () => {
    const r = detectUserEnumeration(probe(200, "ok", 100), probe(404, "nf", 100));
    expect(r.enumeration).toBe(true);
    expect(r.reason).toContain("HTTP 200");
    expect(r.reason).toContain("HTTP 404");
  });
  it("detecteert verschillende body bij gelijke status", () => {
    const r = detectUserEnumeration(
      probe(200, "If that account exists, a reset link has been sent.", 100),
      probe(200, "No account found with that email.", 100),
    );
    expect(r.enumeration).toBe(true);
    expect(r.reason).toContain("andere body");
  });
  it("negeert whitespace/case-verschillen in de body", () => {
    const r = detectUserEnumeration(
      probe(200, "  Reset   Link Sent  ", 100),
      probe(200, "reset link sent", 100),
    );
    expect(r.enumeration).toBe(false);
  });
  it("negeert vluchtige tokens (CSRF-nonce/timestamp) in een verder gelijke body", () => {
    // Zelfde pagina, enkel een ander anti-CSRF-token en timestamp per request:
    // dat mag geen user-enumeration zijn.
    const r = detectUserEnumeration(
      probe(200, "Reset link sent. csrf=aZ9bYx8W7vUt6sRq5pOn4mLk3jIh2gFe token 1712345678", 100),
      probe(200, "Reset link sent. csrf=Qw1eR2tY3uI4oP5aS6dF7gH8jK9lZ0xC token 1712349999", 120),
    );
    expect(r.enumeration).toBe(false);
  });
  it("detecteert timing-verschil boven de drempel", () => {
    const r = detectUserEnumeration(
      probe(200, "ok", 100),
      probe(200, "ok", 100 + ENUMERATION_TIMING_THRESHOLD_MS),
    );
    expect(r.enumeration).toBe(true);
    expect(r.reason).toContain("timing");
  });
  it("geeft geen enumeratie bij uniforme respons", () => {
    const r = detectUserEnumeration(probe(200, "ok", 100), probe(200, "ok", 120));
    expect(r.enumeration).toBe(false);
  });
});

describe("detectSessionRotation", () => {
  it("roteert wanneer voor/na verschillen", () => {
    expect(detectSessionRotation("abc", "xyz")).toEqual({ rotated: true, measurable: true });
  });
  it("detecteert fixatie wanneer voor/na identiek", () => {
    expect(detectSessionRotation("abc", "abc")).toEqual({ rotated: false, measurable: true });
  });
  it("is niet meetbaar wanneer een id ontbreekt", () => {
    expect(detectSessionRotation(null, "xyz")).toEqual({ rotated: false, measurable: false });
    expect(detectSessionRotation("abc", null)).toEqual({ rotated: false, measurable: false });
    expect(detectSessionRotation(null, null)).toEqual({ rotated: false, measurable: false });
  });
});

describe("isSessionCookie", () => {
  it("herkent bekende sessie-cookienamen", () => {
    expect(isSessionCookie("session")).toBe(true);
    expect(isSessionCookie("connect.sid")).toBe(true);
    expect(isSessionCookie("PHPSESSID")).toBe(true);
    expect(isSessionCookie("laravel_session")).toBe(true);
    expect(isSessionCookie("auth_token")).toBe(true);
  });
  it("verwerpt niet-sessie-cookienamen", () => {
    expect(isSessionCookie("theme")).toBe(false);
    expect(isSessionCookie("cart_id")).toBe(false);
  });
  it("classificeert double-submit CSRF-cookies NIET als sessie-cookie", () => {
    // Deze horen JS-leesbaar te zijn; ze mogen geen "HttpOnly ontbreekt" triggeren.
    expect(isSessionCookie("csrftoken")).toBe(false);
    expect(isSessionCookie("XSRF-TOKEN")).toBe(false);
    expect(isSessionCookie("csrf")).toBe(false);
  });
});

describe("sessionCookieIssues — CSRF-cookies", () => {
  it("negeert een CSRF-cookie zonder HttpOnly (geen valse waarschuwing)", () => {
    const issues = sessionCookieIssues([
      { name: "csrftoken", secure: true, http_only: false, same_site: "lax" },
    ]);
    expect(issues).toEqual([]);
  });
});

describe("sessionCookieIssues", () => {
  function cookie(over: Partial<AuthSessionCookie> = {}): AuthSessionCookie {
    return { name: "session", secure: true, http_only: true, same_site: "lax", ...over };
  }
  it("geeft geen issues voor een goed geconfigureerde cookie", () => {
    expect(sessionCookieIssues([cookie()])).toEqual([]);
  });
  it("meldt ontbrekende Secure-flag", () => {
    const out = sessionCookieIssues([cookie({ secure: false })]);
    expect(out[0]!.issues).toContain("Secure ontbreekt");
  });
  it("meldt ontbrekende HttpOnly-flag", () => {
    const out = sessionCookieIssues([cookie({ http_only: false })]);
    expect(out[0]!.issues).toContain("HttpOnly ontbreekt");
  });
  it("meldt SameSite=None zonder Secure", () => {
    const out = sessionCookieIssues([cookie({ same_site: "none", secure: false })]);
    expect(out[0]!.issues).toContain("SameSite=None zonder Secure");
  });
  it("meldt SameSite=None met Secure als zwakker", () => {
    const out = sessionCookieIssues([cookie({ same_site: "none" })]);
    expect(out[0]!.issues).toContain("SameSite=None (zwakker dan Lax/Strict)");
  });
  it("meldt ontbrekende SameSite", () => {
    const out = sessionCookieIssues([cookie({ same_site: "" })]);
    expect(out[0]!.issues).toContain("SameSite ontbreekt");
  });
  it("negeert niet-sessie-cookies", () => {
    expect(sessionCookieIssues([cookie({ name: "theme" })])).toEqual([]);
  });
});

describe("AUTH_FLOW_CHECK_IDS", () => {
  it("bevat precies zeven auth-*-ids", () => {
    expect(AUTH_FLOW_CHECK_IDS).toHaveLength(7);
    expect(AUTH_FLOW_CHECK_IDS.every((id) => id.startsWith("auth-"))).toBe(true);
  });
});
