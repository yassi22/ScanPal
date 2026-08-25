import { describe, expect, it, vi } from "vitest";
import type { Reputation } from "@scanpal/shared";
import { createThreatIntelCheck } from "../threat-intel";

function ctx() {
  return {
    url: "https://www.example.com/about",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn(async () => ({ ok: true })),
  } as never;
}

const noKeys = {
  spamhaus: null,
  urlhaus: null,
  safeBrowsing: null,
  virusTotal: null,
  abuseIpdb: null,
};

function reputation(overrides: Partial<Reputation> = {}): Reputation {
  return {
    host: "example.com",
    ips: ["203.0.113.10"],
    edge_detected: false,
    sources: [],
    worst_severity: "info",
    measured_at: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("threat-intel check", () => {
  it("zonder enige key levert één info-finding met IP-evidence", async () => {
    const client = {
      lookup: vi.fn(async () =>
        reputation({
          sources: [
            { source: "spamhaus", queried: false, listed: false },
            { source: "urlhaus", queried: false, listed: false },
            { source: "safe-browsing", queried: false, listed: false },
            { source: "virustotal", queried: false, listed: false },
            { source: "abuseipdb", queried: false, listed: false },
          ],
        }),
      ),
    };
    const check = createThreatIntelCheck(
      { redis: {} as never },
      { keys: noKeys, client: client as never },
    );
    const results = await check.run(ctx());
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].severity).toBeUndefined();
    expect(results[0].detail).toContain("Geen reputatiebronnen");
    expect(client.lookup).toHaveBeenCalledTimes(1);
    expect((results[0].evidence as unknown as { ips: string[] }).ips).toEqual(["203.0.113.10"]);
    expect((results[0].evidence as unknown as { sources: unknown[] }).sources).toHaveLength(5);
  });

  it("een Safe Browsing-hit wordt high", async () => {
    const client = {
      lookup: vi.fn(async () =>
        reputation({
          sources: [{ source: "safe-browsing", queried: true, listed: true, categories: ["MALWARE"] }],
          worst_severity: "high",
        }),
      ),
    };
    const check = createThreatIntelCheck(
      { redis: {} as never },
      { keys: { ...noKeys, safeBrowsing: "key" }, client: client as never },
    );
    const results = await check.run(ctx());
    expect(results[0]).toMatchObject({ status: "fail", severity: "high" });
  });

  it("markeert edge-IP-context expliciet in detail en evidence", async () => {
    const client = {
      lookup: vi.fn(async () =>
        reputation({
          edge_detected: true,
          sources: [{ source: "abuseipdb", queried: true, listed: true, categories: ["confidence:80"] }],
          worst_severity: "medium",
        }),
      ),
    };
    const check = createThreatIntelCheck(
      { redis: {} as never },
      { keys: { ...noKeys, abuseIpdb: "key" }, client: client as never },
    );
    const results = await check.run(ctx());
    expect(results[0].detail).toContain("Edge/proxy");
    expect((results[0].evidence as unknown as { edge_detected: boolean }).edge_detected).toBe(true);
  });
});
