import { describe, it, expect, vi } from "vitest";
import {
  COOKIE_CHECK_IDS,
  collectSetCookieHeaders,
  parseSetCookieHeader,
  parseSetCookieHeaders,
  isSessionCookie,
  evaluateCookies,
  cookiesCheck,
  type SetCookieHeaderSource,
} from "../cookies";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function sourceOf(headers: string[]): SetCookieHeaderSource {
  return { getSetCookie: () => headers };
}

describe("collectSetCookieHeaders", () => {
  it("leest meerdere Set-Cookie-headers via getSetCookie", () => {
    expect(
      collectSetCookieHeaders(sourceOf(["a=1", "b=2"])),
    ).toEqual(["a=1", "b=2"]);
  });

  it("filtert lege headers weg", () => {
    expect(collectSetCookieHeaders(sourceOf(["a=1", ""]))).toEqual(["a=1"]);
  });

  it("valt terug op get('set-cookie') wanneer getSetCookie ontbreekt", () => {
    expect(
      collectSetCookieHeaders({ get: () => "a=1; HttpOnly" }),
    ).toEqual(["a=1; HttpOnly"]);
    expect(collectSetCookieHeaders({ get: () => null })).toEqual([]);
  });
});

describe("parseSetCookieHeader", () => {
  it("splitst naam, waarde en attributen (case-insensitief)", () => {
    const c = parseSetCookieHeader("SID=abc; HttpOnly; SECURE; SameSite=Lax");
    expect(c?.name).toBe("SID");
    expect(c?.value).toBe("abc");
    expect(c?.attributes).toEqual({ httponly: "", secure: "", samesite: "Lax" });
  });

  it("respecteert een puntkomma binnen quotes in de waarde", () => {
    const c = parseSetCookieHeader('token="a;b;c"; Path=/');
    expect(c?.value).toBe('"a;b;c"');
    expect(c?.attributes).toEqual({ path: "/" });
  });

  it("handhaaft komma's in Expires (niet splitsen — parse per header)", () => {
    const c = parseSetCookieHeader(
      "session=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Max-Age=31536000",
    );
    expect(c?.name).toBe("session");
    expect(c?.attributes.expires).toBe("Wed, 09 Jun 2027 10:18:14 GMT");
    expect(c?.attributes["max-age"]).toBe("31536000");
  });

  it("accepteert een cookie zonder attributen en zonder waarde", () => {
    expect(parseSetCookieHeader("flag")?.value).toBe("");
    expect(parseSetCookieHeader("flag")?.attributes).toEqual({});
  });

  it("levert null bij een lege header", () => {
    expect(parseSetCookieHeader("")).toBeNull();
    expect(parseSetCookieHeader("   ")).toBeNull();
  });

  it("behandelt meerdere Set-Cookie-headers via parseSetCookieHeaders", () => {
    const cookies = parseSetCookieHeaders(["a=1; HttpOnly", "b=2; Secure"]);
    expect(cookies.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("isSessionCookie", () => {
  it("herkent de expliciete set en patronen", () => {
    expect(isSessionCookie("JSESSIONID")).toBe(true);
    expect(isSessionCookie("connect.sid")).toBe(true);
    expect(isSessionCookie("ASP.NET_SessionId")).toBe(true);
    expect(isSessionCookie("auth_token")).toBe(true);
    expect(isSessionCookie("user-session")).toBe(true);
    expect(isSessionCookie("sid")).toBe(true);
  });

  it("wijst niet-sessie-cookies af", () => {
    expect(isSessionCookie("prefs")).toBe(false);
    expect(isSessionCookie("theme")).toBe(false);
    expect(isSessionCookie("cart_id")).toBe(false);
  });
});

describe("evaluateCookies", () => {
  it("produceert vijf checks in catalog-volgorde (fan-out)", () => {
    const results = evaluateCookies([]);
    expect(results.map((r) => r.id)).toEqual([...COOKIE_CHECK_IDS]);
  });

  it("geeft vijf pass/info-findings bij geen cookies", () => {
    const results = evaluateCookies([]);
    for (const r of results) {
      expect(r.status).toBe("pass");
      expect(r.detail).toBe("Geen Set-Cookie headers gevonden");
    }
  });

  it("geeft vijf pass-findings bij een volledig correcte cookie", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders([
        "__Host-session=abc; Path=/; Secure; HttpOnly; SameSite=Lax",
      ]),
    );
    for (const r of results) {
      expect(r.status).toBe("pass");
    }
  });

  it("bumpt HttpOnly/Secure naar high op een sessie-cookie", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["connect.sid=abc; SameSite=Lax"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-httponly")?.status).toBe("warn");
    expect(byId.get("cookie-httponly")?.severity).toBe("high");
    expect(byId.get("cookie-secure")?.status).toBe("warn");
    expect(byId.get("cookie-secure")?.severity).toBe("high");
  });

  it("houdt medium voor ontbrekend HttpOnly/Secure op een niet-sessie-cookie", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["prefs=dark; SameSite=Lax"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-httponly")?.severity).toBe("medium");
    expect(byId.get("cookie-secure")?.severity).toBe("medium");
  });

  it("flagt SameSite=None zonder Secure als fail/high (cookie wordt verworpen)", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["prefs=dark; SameSite=None; HttpOnly"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-samesite")?.status).toBe("fail");
    expect(byId.get("cookie-samesite")?.severity).toBe("high");
    expect(byId.get("cookie-samesite")?.evidence).toBe(
      "prefs=dark; SameSite=None; HttpOnly",
    );
  });

  it("accepteert SameSite=None mét Secure", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["prefs=dark; SameSite=None; Secure; HttpOnly"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-samesite")?.status).toBe("pass");
  });

  it("flagt ontbrekend SameSite als warn/medium", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["prefs=dark; Secure; HttpOnly"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-samesite")?.status).toBe("warn");
    expect(byId.get("cookie-samesite")?.severity).toBe("medium");
  });

  it("flagt __Host- zonder vereisten als low", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["__Host-token=abc; Path=/login; Domain=ex.com"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-prefixes")?.status).toBe("warn");
    expect(byId.get("cookie-prefixes")?.severity).toBe("low");
    expect(byId.get("cookie-prefixes")?.detail).toContain("__Host-token");
  });

  it("flagt __Secure- zonder Secure als low", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["__Secure-token=abc"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-prefixes")?.status).toBe("warn");
    expect(byId.get("cookie-prefixes")?.severity).toBe("low");
  });

  it("flagt een sessie-cookie met Expires/Max-Age als persistent (low)", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders([
        "connect.sid=abc; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000",
      ]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-expiry")?.status).toBe("warn");
    expect(byId.get("cookie-expiry")?.severity).toBe("low");
  });

  it("flagt Max-Age=0 niet als persistent (deletion)", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders([
        "connect.sid=abc; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-expiry")?.status).toBe("pass");
  });

  it("negeert expiry op niet-sessie-cookies", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders([
        "prefs=dark; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000",
      ]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-expiry")?.status).toBe("pass");
  });

  it("zet evidence op de raw Set-Cookie-header(s) bij warn", () => {
    const results = evaluateCookies(
      parseSetCookieHeaders(["prefs=dark; SameSite=Lax"]),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("cookie-httponly")?.evidence).toBe("prefs=dark; SameSite=Lax");
  });
});

describe("cookiesCheck.run", () => {
  it("verwerkt één fetchPage-response naar vijf findings", async () => {
    const headers = new Headers();
    headers.append("set-cookie", "connect.sid=abc; HttpOnly; Secure; SameSite=Lax");
    headers.append("set-cookie", "prefs=dark");
    mockedFetchPage.mockResolvedValueOnce(new Response(null, { headers }));

    const results = await cookiesCheck.run({
      url: "https://example.com",
      scanId: "scan-1",
      activeTests: false,
      rateLimit: {} as never,
    });

    expect(mockedFetchPage).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.id)).toEqual([...COOKIE_CHECK_IDS]);
    const byId = new Map(results.map((r) => [r.id, r]));
    // prefs mist HttpOnly/Secure/SameSite → warn; connect.sid is ok.
    expect(byId.get("cookie-httponly")?.status).toBe("warn");
    expect(byId.get("cookie-secure")?.status).toBe("warn");
    expect(byId.get("cookie-samesite")?.status).toBe("warn");
  });

  it("geeft vijf info-findings als de pagina niet bereikbaar is", async () => {
    mockedFetchPage.mockRejectedValueOnce(new Error("timeout"));
    const results = await cookiesCheck.run({
      url: "https://example.com",
      scanId: "scan-1",
      activeTests: false,
      rateLimit: {} as never,
    });
    expect(results).toHaveLength(COOKIE_CHECK_IDS.length);
    for (const r of results) {
      expect(r.status).toBe("info");
      expect(r.detail).toContain("niet controleerbaar");
    }
  });
});
