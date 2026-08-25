import { describe, expect, it, vi } from "vitest";
import {
  detectEdgeProxy,
  parseSpamhausDqsAnswers,
  querySpamhausDqs,
  resolveIps,
  spamhausDqsQueryName,
} from "../domain-net";

function resolver(overrides: Record<string, unknown>) {
  return overrides as unknown as typeof import("node:dns/promises");
}

describe("resolveIps en edge-detectie", () => {
  it("combineert en dedupliceert A/AAAA", async () => {
    const dnsResolver = resolver({
      resolve4: vi.fn(async () => ["203.0.113.10", "203.0.113.10"]),
      resolve6: vi.fn(async () => ["2001:db8::10"]),
    });
    expect(await resolveIps("example.com", { dnsResolver })).toEqual([
      "2001:db8::10",
      "203.0.113.10",
    ]);
  });

  it("markeert een bekende CDN-CNAME als edge", async () => {
    const dnsResolver = resolver({
      resolveCname: vi.fn(async () => ["d111111abcdef8.cloudfront.net"]),
    });
    expect(await detectEdgeProxy("www.example.com", { dnsResolver })).toBe(true);
  });
});

describe("Spamhaus DQS", () => {
  it("bouwt IPv4-, IPv6- en domeinqueries", () => {
    expect(spamhausDqsQueryName("203.0.113.79", "key")?.query).toBe(
      "79.113.0.203.key.zen.dq.spamhaus.net",
    );
    expect(spamhausDqsQueryName("example.com", "key")?.query).toBe(
      "example.com.key.dbl.dq.spamhaus.net",
    );
    expect(spamhausDqsQueryName("2001:db8::45", "key")?.query).toContain(
      ".key.zen.dq.spamhaus.net",
    );
  });

  it("parsed alle ZEN/DBL-return-codes en DQS-errors", () => {
    expect(
      parseSpamhausDqsAnswers("zen", ["127.0.0.2", "127.0.0.4"]).categories,
    ).toEqual(["ZEN:SBL", "ZEN:XBL"]);
    expect(parseSpamhausDqsAnswers("dbl", ["127.0.1.5"]).categories).toEqual([
      "DBL:malware",
    ]);
    expect(parseSpamhausDqsAnswers("zen", ["127.255.255.250"]).queried).toBe(false);
  });

  it("behandelt NXDOMAIN als schoon en SERVFAIL als onbereikbaar", async () => {
    const cleanResolver = resolver({
      resolve: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      }),
    });
    expect((await querySpamhausDqs("example.com", "key", { dnsResolver: cleanResolver })).queried).toBe(true);

    const failedResolver = resolver({
      resolve: vi.fn(async () => {
        throw Object.assign(new Error("servfail"), { code: "SERVFAIL" });
      }),
    });
    expect((await querySpamhausDqs("example.com", "key", { dnsResolver: failedResolver })).queried).toBe(false);
  });
});
