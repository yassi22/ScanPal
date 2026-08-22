import { describe, expect, it } from "vitest";
import { isBlockedIp } from "../webhook-security";

/**
 * Regressie voor S1/S2 (security-review 2026-08-22): de blocklist mag niet te
 * omzeilen zijn via IPv4-mapped IPv6 (`::ffff:…`, waar `URL.hostname` naar hex
 * normaliseert), en moet de volledige ULA-range `fc00::/7` dekken — niet enkel
 * de string "fd00".
 */
describe("isBlockedIp — IPv6", () => {
  const normalize = (literal: string) => {
    const host = new URL(`http://[${literal}]/`).hostname;
    return host.startsWith("[") ? host.slice(1, -1) : host;
  };

  it("blocks IPv4-mapped IPv6 (hex-genormaliseerd door URL.hostname)", () => {
    // Zo komen ze binnen na `new URL(...).hostname`.
    expect(isBlockedIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254 (metadata)
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isBlockedIp("::ffff:a00:5")).toBe(true); // 10.0.0.5
    expect(isBlockedIp("::ffff:c0a8:1")).toBe(true); // 192.168.0.1
  });

  it("blocks IPv4-mapped IPv6 end-to-end via URL.hostname", () => {
    for (const literal of [
      "::ffff:169.254.169.254",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.5",
    ]) {
      expect(isBlockedIp(normalize(literal))).toBe(true);
    }
  });

  it("blocks the full ULA range fc00::/7, not only fd00::", () => {
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fcff::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("fdff::1")).toBe(true);
    expect(isBlockedIp("fdaa:bbcc::1")).toBe(true);
  });

  it("blocks loopback, unspecified and link-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("allows legitimate global IPv6", () => {
    expect(isBlockedIp("2001:db8::1")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare
  });
});

describe("isBlockedIp — IPv4", () => {
  it("blocks private/loopback/link-local/CGNAT ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.5",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});
