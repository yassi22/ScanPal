import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-guard voor outbound webhooks (plan 15, besluit 6): loopback/private
 * targets worden geweigerd — statisch op het hostname én bij delivery via
 * DNS-resolutie (anti-DNS-rebinding) en bij elke redirect-stap.
 *
 * Dev-uitzondering: `http://localhost` alleen als NODE_ENV !== "production".
 */

export type UrlAllowance =
  | { ok: true }
  | { ok: false; reason: string };

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && (b & 0xf0) === 16) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }
  if (version === 6) {
    const groups = expandIPv6(ip);
    const first = groups[0];
    const last = groups[groups.length - 1];
    if (last?.includes(".")) {
      // IPv4-mapped (::ffff:127.0.0.1) — de IPv4 kant checken
      return isBlockedIp(last);
    }
    if (groups.every((g) => g === "0000") && last === "0001") return true; // ::1
    if (first === "fd00") return true; // fd00::/8
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
