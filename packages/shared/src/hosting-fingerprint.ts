import { z } from "zod";
import type { HeaderSource } from "./stack-detection";

/**
 * Plan 69 — hosting-fingerprint security. Pure logica (geen fetch): de worker
 * levert de al-gefetchte response-headers + de scan-URL; deze module
 * fingerprint het hosting-/CDN-platform en beoordeelt platform-specifieke
 * security-signalen die de generieke `security-headers`-check (28) niet kent
 * (cache-hygiëne bij geauthenticeerde documenten, origin-lek achter een CDN,
 * publiek bereikbare preview/branch-deploys). Beoordeelt géén header-aanwezigheid
 * opnieuw — geen dubbele findings met check 28.
 */

export type HostingPlatform =
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "fastly"
  | "cloudfront"
  | "github-pages"
  | "unknown";

export type HostingSignal = {
  signal: string;
  detail: string;
  severity: "low" | "info" | "medium";
};

export type HostingFingerprint = {
  platform: HostingPlatform;
  signals: HostingSignal[];
  evidence_headers: Record<string, string>;
};

export const hostingFingerprintEvidenceSchema = z.object({
  kind: z.literal("hosting-fingerprint"),
  platform: z.enum([
    "vercel",
    "netlify",
    "cloudflare",
    "fastly",
    "cloudfront",
    "github-pages",
    "unknown",
  ]),
  signals: z.array(
    z.object({
      signal: z.string(),
      detail: z.string(),
      severity: z.enum(["low", "info", "medium"]),
    }),
  ),
  evidence_headers: z.record(z.string(), z.string()),
});
export type HostingFingerprintEvidence = z.infer<
  typeof hostingFingerprintEvidenceSchema
>;

/** Header-namen die een platform verraaden (lowercase). */
const PLATFORM_HEADERS = [
  "server",
  "x-vercel-id",
  "x-vercel-cache",
  "x-nf-request-id",
  "cf-ray",
  "cf-cache-status",
  "x-served-by",
  "x-timer",
  "x-amz-cf-id",
  "x-github-request-id",
  "cache-control",
  "set-cookie",
  "content-type",
];

function hget(headers: HeaderSource, name: string): string {
  return (headers.get(name) ?? "").toLowerCase();
}

function detectPlatform(headers: HeaderSource): HostingPlatform {
  if (hget(headers, "cf-ray") || hget(headers, "server").includes("cloudflare")) {
    return "cloudflare";
  }
  if (hget(headers, "x-vercel-id") || hget(headers, "server").includes("vercel")) {
    return "vercel";
  }
  if (
    hget(headers, "x-nf-request-id") ||
    hget(headers, "server").includes("netlify")
  ) {
    return "netlify";
  }
  if (hget(headers, "x-served-by").includes("cache") || hget(headers, "x-timer")) {
    return "fastly";
  }
  if (hget(headers, "x-amz-cf-id")) {
    return "cloudfront";
  }
  if (
    hget(headers, "server").includes("github.com") ||
    hget(headers, "x-github-request-id")
  ) {
    return "github-pages";
  }
  return "unknown";
}

/** Cookie-naam-substrings die op een geauthenticeerde sessie wijzen (lowercase). */
const AUTH_COOKIE_HINTS = ["session", "sid", "auth", "token", "jwt", "login"];

/**
 * Heuristiek: wijst een `set-cookie`-header op een geauthenticeerd document.
 * Matcht op cookie-**namen** (het deel vóór `=`), niet op waarden — een
 * cookie-waarde die toevallig "token" bevat triggert dus geen false positive.
 * `includes` i.p.v. `startsWith` vangt ook `connect.sid`, `jsessionid`,
 * `phpsessid` (Express/Java/PHP-sessiecookies).
 */
function looksAuthenticated(setCookie: string): boolean {
  const names = setCookie
    .split(/[;,]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.includes("="))
    .map((part) => part.slice(0, part.indexOf("=")));
  return names.some((name) => AUTH_COOKIE_HINTS.some((hint) => name.includes(hint)));
}

/** Origin-server-software die een CDN normaal verbergt (lowercase substring). */
const ORIGIN_SERVERS = ["nginx", "apache", "microsoft-iis", "express", "gunicorn", "uvicorn"];

function isPreviewUrl(url: string, platform: HostingPlatform): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (platform === "vercel" && host.endsWith(".vercel.app")) {
    return host.includes("-git-");
  }
  if (platform === "netlify" && host.endsWith(".netlify.app")) {
    return host.includes("--");
  }
  return false;
}

/**
 * Fingerprint het hosting-/CDN-platform uit response-headers en beoordeel
 * platform-specifieke security-signalen. Puur; geen extra requests.
 */
export function fingerprintHosting(
  headers: HeaderSource,
  url: string,
): HostingFingerprint {
  const platform = detectPlatform(headers);

  const evidence_headers: Record<string, string> = {};
  for (const name of PLATFORM_HEADERS) {
    const value = headers.get(name);
    if (value) evidence_headers[name] = value.slice(0, 200);
  }

  const signals: HostingSignal[] = [];

  // Cache-hygiëne: `cache-control: public` op een geauthenticeerd document
  // (set-cookie met sessie/auth-token) kan content via gedeelde caches lekken.
  const cacheControl = hget(headers, "cache-control");
  const setCookie = headers.get("set-cookie") ?? "";
  if (
    cacheControl.includes("public") &&
    !cacheControl.includes("private") &&
    looksAuthenticated(setCookie)
  ) {
    signals.push({
      signal: "cache-hygiene",
      detail:
        "cache-control: public op een document met sessie-cookie — geauthenticeerde content kan via gedeelde caches lekken",
      severity: "medium",
    });
  }

  // Origin-lek achter Cloudflare: cf-ray aanwezig maar `server` verraadt de
  // origin-server (nginx/apache/…) i.p.v. cloudflare → origin-IP-risico.
  if (platform === "cloudflare") {
    const server = hget(headers, "server");
    if (server && !server.includes("cloudflare")) {
      if (ORIGIN_SERVERS.some((s) => server.includes(s))) {
        signals.push({
          signal: "origin-leak",
          detail: `server-header ("${server}") verraadt de origin-server achter Cloudflare — overweeg de origin-IP te verbergen`,
          severity: "low",
        });
      }
    }
  }

  // Preview-/branch-deploy publiek bereikbaar als scan-target.
  if (isPreviewUrl(url, platform)) {
    signals.push({
      signal: "preview-url",
      detail:
        "scan-target is een preview/branch-deploy die publiek bereikbaar is — scan de productie-URL",
      severity: "low",
    });
  }

  return { platform, signals, evidence_headers };
}

const PLATFORM_LABEL: Record<HostingPlatform, string> = {
  vercel: "Vercel",
  netlify: "Netlify",
  cloudflare: "Cloudflare",
  fastly: "Fastly",
  cloudfront: "AWS CloudFront",
  "github-pages": "GitHub Pages",
  unknown: "onbekend",
};

export function hostingFingerprintEvidence(
  fp: HostingFingerprint,
): HostingFingerprintEvidence {
  return {
    kind: "hosting-fingerprint",
    platform: fp.platform,
    signals: fp.signals,
    evidence_headers: fp.evidence_headers,
  };
}

export function evaluateHostingFingerprint(fp: HostingFingerprint): {
  status: "pass" | "warn" | "info";
  detail: string;
  severity?: "low" | "info" | "medium";
} {
  const label = PLATFORM_LABEL[fp.platform];
  if (fp.platform === "unknown") {
    const server = fp.evidence_headers["server"] ?? "";
    return {
      status: "info",
      detail: server
        ? `Hosting niet herkend (server: "${server.slice(0, 60)}")`
        : "Hosting niet herkend uit response-headers",
    };
  }
  if (fp.signals.length === 0) {
    return {
      status: "pass",
      detail: `Gehost op ${label}; geen platform-specifieke misconfiguraties gevonden`,
    };
  }
  const worst = fp.signals.some((s) => s.severity === "medium")
    ? "medium"
    : fp.signals.some((s) => s.severity === "low")
      ? "low"
      : "info";
  return {
    status: "warn",
    severity: worst,
    detail: `${label}: ${fp.signals.map((s) => s.detail).join("; ")}`,
  };
}
