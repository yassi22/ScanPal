import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-guard voor outbound webhooks (plan 15, besluit 6): loopback/private
 * targets worden geweigerd — statisch op het hostname én bij delivery via
 * DNS-resolutie (anti-DNS-rebinding) en bij elke redirect-stap.
 *
 * Dev-uitzondering: `http://localhost` alleen als NODE_ENV !== "production".
 *
 * DNS-rebinding TOCTOU: `isUrlAllowed` resolveert DNS en checkt het IP, maar
 * `fetch` resolveert onafhankelijk opnieuw. De onderstaande DNS-cache (korte
 * TTL) verkleint het venster aanzienlijk; een volledige fix vereist een custom
 * HTTP-agent die het opgeloste IP pin't (toekomstige verbetering).
 */

const DNS_CACHE_TTL_MS = 30_000;
const dnsCache = new Map<string, { addresses: { address: string }[]; expires: number }>();

async function resolveHost(host: string): Promise<{ address: string }[] | null> {
  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) {
    return cached.addresses;
  }
  try {
    const addresses = await lookup(host, { all: true });
    dnsCache.set(host, { addresses, expires: Date.now() + DNS_CACHE_TTL_MS });
    return addresses;
  } catch {
    return null;
  }
}

export type UrlAllowance =
  | { ok: true }
  | { ok: false; reason: string };

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && (b & 0xf0) === 16) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }
  if (version === 6) {
    const parts = expandIPv6(ip);
    const last = parts[parts.length - 1];
    if (last?.includes(".")) {
      // IPv4-mapped/-compatible in dotted vorm (::ffff:127.0.0.1) — check de v4-kant.
      return isBlockedIp(last);
    }
    // Numerieke groepen. `URL.hostname` normaliseert v4-mapped adressen NAAR hex
    // (`::ffff:a9fe:a9fe`), dus de dotted-branch hierboven is dan dode code — we
    // moeten de v4-kant ook uit de hex-groepen reconstrueren, anders is de hele
    // blocklist te omzeilen via `::ffff:169.254.169.254` (SSRF naar metadata).
    const g = parts.map((part) => parseInt(part, 16));
    const firstFiveZero =
      g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    // v4-mapped (`::ffff:a.b.c.d`, g[5]=ffff) of -compatible (`::a.b.c.d`, g[5]=0).
    // Sluit `::` en `::1` uit — die blijven loopback/unspecified, geen 0.0.0.x.
    const isLoopbackOrUnspecified =
      firstFiveZero && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1);
    if (
      firstFiveZero &&
      (g[5] === 0xffff || g[5] === 0) &&
      !isLoopbackOrUnspecified
    ) {
      const v4 = `${g[6] >>> 8}.${g[6] & 0xff}.${g[7] >>> 8}.${g[7] & 0xff}`;
      return isBlockedIp(v4);
    }
    if (g.every((group) => group === 0)) return true; // :: (unspecified)
    if (isLoopbackOrUnspecified && g[7] === 1) return true; // ::1 (loopback)
    // fc00::/7 (ULA, fc00–fdff) — eerdere versie matchte alleen de string "fd00".
    if (g[0] >= 0xfc00 && g[0] <= 0xfdff) return true;
    // fe80::/10 (link-local): eerste groep in fe80–febf.
    if (g[0] >= 0xfe80 && g[0] <= 0xfebf) return true;
    return false;
  }
  return false;
}

function expandIPv6(ip: string): string[] {
  const [head = "", tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  return [
    ...headParts,
    ...Array(Math.max(0, missing)).fill("0"),
    ...tailParts,
  ].map((part) => part.padStart(4, "0"));
}

/**
 * URL-guard: protocol + localhost-uitzondering + (optioneel) DNS-resolutie.
 * `resolve: false` voor de statische create-check in tests/wanneer DNS niet
 * nodig is; de deliverer resolved altijd (anti-DNS-rebinding).
 */
export async function isUrlAllowed(
  url: string,
  opts: { resolve?: boolean } = {},
): Promise<UrlAllowance> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  const isProduction = process.env.NODE_ENV === "production";
  const host = parsed.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    if (!isProduction) return { ok: true };
    return { ok: false, reason: "localhost" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "protocol" };
  }
  if (isProduction && parsed.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }

  const ipVersion = isIP(host);
  if (ipVersion !== 0) {
    return isBlockedIp(host) ? { ok: false, reason: "blocked-ip" } : { ok: true };
  }

  if (opts.resolve === false) return { ok: true };

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "dns-failure" };
  }
  for (const address of addresses) {
    if (isBlockedIp(address.address)) {
      return { ok: false, reason: "resolved-blocked-ip" };
    }
  }
  return { ok: true };
}
