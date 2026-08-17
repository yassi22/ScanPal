import { checkById, type FindingSeverity, type InlineCheckLike } from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const COOKIE_CHECK_IDS = [
  "cookie-httponly",
  "cookie-secure",
  "cookie-samesite",
  "cookie-prefixes",
  "cookie-expiry",
] as const;

/**
 * Minimaal deel van de Fetch `Headers`-API dat deze check nodig heeft.
 * `getSetCookie` is beschikbaar op undici/Node ≥ 18.14; de fallback leest de
 * enkele raw `set-cookie`-header (best-effort bij een enkele cookie).
 */
export type SetCookieHeaderSource = {
  getSetCookie?: () => string[];
  get?: (name: string) => string | null;
};

export type ParsedCookie = {
  name: string;
  value: string;
  /** lowercased attribuutnaam → waarde ("" bij een flag zoals HttpOnly). */
  attributes: Record<string, string>;
  /** De originele Set-Cookie-header zoals ontvangen. */
  raw: string;
};

export function collectSetCookieHeaders(source: SetCookieHeaderSource): string[] {
  if (typeof source.getSetCookie === "function") {
    return source.getSetCookie().filter((h) => h.length > 0);
  }
  const single = source.get?.("set-cookie");
  return single ? [single] : [];
}

/**
 * Splits een Set-Cookie-header op `;` maar respecteer dubbele quotes in de
 * cookie-waarde (een `;` binnen quotes hoort bij de waarde, niet bij een
 * attribuut-scheider). Attribuutnamen zijn case-insensitief.
 */
export function parseSetCookieHeader(header: string): ParsedCookie | null {
  const parts = splitSemicolons(header);
  const first = parts.shift()?.trim();
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq < 0) {
    return { name: first, value: "", attributes: {}, raw: header };
  }
  const name = first.slice(0, eq).trim();
  if (!name) return null;
  const value = first.slice(eq + 1).trim();
  const attributes: Record<string, string> = {};
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const aEq = p.indexOf("=");
    if (aEq < 0) {
      attributes[p.toLowerCase()] = "";
    } else {
      const attrName = p.slice(0, aEq).trim().toLowerCase();
      const attrVal = p.slice(aEq + 1).trim();
      attributes[attrName] = attrVal;
    }
  }
  return { name, value, attributes, raw: header };
}

function splitSemicolons(input: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === ";" && !inQuotes) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

export function parseSetCookieHeaders(headers: string[]): ParsedCookie[] {
  return headers
    .map(parseSetCookieHeader)
    .filter((c): c is ParsedCookie => c !== null);
}

const SESSION_PATTERNS = ["session", "sess", "sid", "auth", "token", "credential"];
const SESSION_EXPLICIT = new Set([
  "jsessionid",
  "phpsessid",
  "connect.sid",
  "asp.net_sessionid",
  "laravel_session",
  "wordpress_logged_in",
  "wordpress_sec",
  "cfid",
  "cftoken",
  "rails.session",
  "_session_id",
]);

/**
 * Herkent sessie-achtige cookie-namen: een expliciete set bekende
 * sessie-cookie-namen, plus namen die een sessie-achtig patroon bevatten
 * (session/sess/sid/auth/token/credential). Ontbrekend Secure/HttpOnly op zo'n
 * cookie levert een severity-bump (high i.p.v. medium).
 */
export function isSessionCookie(name: string): boolean {
  const lower = name.toLowerCase();
  if (SESSION_EXPLICIT.has(lower)) return true;
  return SESSION_PATTERNS.some((p) => lower.includes(p));
}

function hasAttr(cookie: ParsedCookie, name: string): boolean {
  return name in cookie.attributes;
}

function attrValue(cookie: ParsedCookie, name: string): string {
  return cookie.attributes[name] ?? "";
}

type CookieIssue = { cookie: ParsedCookie; reason: string };

function cookieResult(
  id: string,
  offending: CookieIssue[],
  detailAll: string,
  detailPass: string,
  severity: FindingSeverity,
  status: "warn" | "fail" | "pass",
): InlineCheckLike {
  const entry = checkById(id);
  const name = entry?.name ?? id;
  if (offending.length === 0 || status === "pass") {
    return { id, name, status: "pass", detail: detailPass };
  }
  return {
    id,
    name,
    status,
    severity,
    detail: `${detailAll}: ${offending.map((o) => o.cookie.name).join(", ")}`,
    evidence: offending.map((o) => o.cookie.raw).join("\n"),
  };
}

const NO_COOKIES = "Geen Set-Cookie headers gevonden";

/** Per-attribuut evaluatie uit één gedeelde response (één fetch, vijf checks). */
export function evaluateCookies(cookies: ParsedCookie[]): InlineCheckLike[] {
  const hasCookies = cookies.length > 0;

  // cookie-httponly
  const httponlyOffending: CookieIssue[] = cookies
    .filter((c) => !hasAttr(c, "httponly"))
    .map((c) => ({ cookie: c, reason: "HttpOnly ontbreekt" }));
  const httponlySeverity: FindingSeverity = httponlyOffending.some((o) =>
    isSessionCookie(o.cookie.name),
  )
    ? "high"
    : "medium";

  // cookie-secure
  const secureOffending: CookieIssue[] = cookies
    .filter((c) => !hasAttr(c, "secure"))
    .map((c) => ({ cookie: c, reason: "Secure ontbreekt" }));
  const secureSeverity: FindingSeverity = secureOffending.some((o) =>
    isSessionCookie(o.cookie.name),
  )
    ? "high"
    : "medium";

  // cookie-samesite: SameSite=None zonder Secure → fail/high; ontbrekend → warn/medium
  const samesiteInvalid: CookieIssue[] = [];
  const samesiteMissing: CookieIssue[] = [];
  for (const c of cookies) {
    if (!hasAttr(c, "samesite")) {
      samesiteMissing.push({ cookie: c, reason: "SameSite ontbreekt" });
      continue;
    }
    const value = attrValue(c, "samesite").toLowerCase();
    if (value === "none" && !hasAttr(c, "secure")) {
      samesiteInvalid.push({
        cookie: c,
        reason: "SameSite=None zonder Secure (cookie wordt verworpen)",
      });
    } else if (value !== "lax" && value !== "strict" && value !== "none") {
      samesiteMissing.push({ cookie: c, reason: `onbekende SameSite-waarde "${value}"` });
    }
  }
  const samesiteOffending = [...samesiteInvalid, ...samesiteMissing];

  // cookie-prefixes: __Host-/__Secure- met onjuiste attributen
  const prefixOffending: CookieIssue[] = [];
  for (const c of cookies) {
    if (c.name.startsWith("__Host-")) {
      const reasons: string[] = [];
      if (!hasAttr(c, "secure")) reasons.push("Secure ontbreekt");
      if (attrValue(c, "path") !== "/") reasons.push("Path is niet /");
      if (hasAttr(c, "domain")) reasons.push("Domain mag niet op een __Host- cookie");
      if (reasons.length > 0) {
        prefixOffending.push({ cookie: c, reason: `__Host-: ${reasons.join(", ")}` });
      }
    } else if (c.name.startsWith("__Secure-") && !hasAttr(c, "secure")) {
      prefixOffending.push({ cookie: c, reason: "__Secure- zonder Secure" });
    }
  }

  // cookie-expiry: sessie-cookie met Expires/Max-Age (persistent)
  const expiryOffending: CookieIssue[] = [];
  for (const c of cookies) {
    if (!isSessionCookie(c.name)) continue;
    let persistent = hasAttr(c, "expires");
    if (hasAttr(c, "max-age")) {
      const maxAge = Number.parseInt(attrValue(c, "max-age"), 10);
      if (!Number.isNaN(maxAge) && maxAge > 0) persistent = true;
    }
    if (persistent) {
      expiryOffending.push({ cookie: c, reason: "sessie-cookie met Expires/Max-Age (persistent)" });
    }
  }

  const samesiteStatus: "warn" | "fail" | "pass" =
    samesiteInvalid.length > 0 ? "fail" : samesiteMissing.length > 0 ? "warn" : "pass";
  const samesiteSeverity: FindingSeverity =
    samesiteInvalid.length > 0 ? "high" : "medium";

  return [
    cookieResult(
      "cookie-httponly",
      httponlyOffending,
      "HttpOnly ontbreekt",
      hasCookies ? "Alle cookies hebben HttpOnly" : NO_COOKIES,
      httponlySeverity,
      httponlyOffending.length > 0 ? "warn" : "pass",
    ),
    cookieResult(
      "cookie-secure",
      secureOffending,
      "Secure ontbreekt",
      hasCookies ? "Alle cookies hebben Secure" : NO_COOKIES,
      secureSeverity,
      secureOffending.length > 0 ? "warn" : "pass",
    ),
    cookieResult(
      "cookie-samesite",
      samesiteOffending,
      samesiteInvalid.length > 0
        ? "SameSite=None zonder Secure"
        : "SameSite ontbreekt of is onveilig",
      hasCookies ? "Alle cookies hebben een geldige SameSite" : NO_COOKIES,
      samesiteSeverity,
      samesiteStatus,
    ),
    cookieResult(
      "cookie-prefixes",
      prefixOffending,
      "Cookie-prefix onjuist gebruikt",
      hasCookies ? "Cookie-prefixen correct toegepast" : NO_COOKIES,
      "low",
      prefixOffending.length > 0 ? "warn" : "pass",
    ),
    cookieResult(
      "cookie-expiry",
      expiryOffending,
      "Sessie-cookie is persistent",
      hasCookies ? "Sessie-cookies zijn niet persistent" : NO_COOKIES,
      "low",
      expiryOffending.length > 0 ? "warn" : "pass",
    ),
  ];
}

function notCheckable(message: string): InlineCheckLike[] {
  return COOKIE_CHECK_IDS.map((id) => {
    const entry = checkById(id);
    return {
      id,
      name: entry?.name ?? id,
      status: "info",
      detail: `Cookies niet controleerbaar: ${message}`,
    };
  });
}

export const cookiesCheck: CheckImplementation = {
  id: "cookies",
  category: "http",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      const headers = collectSetCookieHeaders(
        response.headers as unknown as SetCookieHeaderSource,
      );
      const cookies = parseSetCookieHeaders(headers);
      return evaluateCookies(cookies);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return notCheckable(message);
    }
  },
};
