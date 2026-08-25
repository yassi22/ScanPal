import { describe, expect, it, vi } from "vitest";
import {
  abuseIpdbLookup,
  createThreatIntelClient,
  safeBrowsingLookup,
  urlhausLookup,
  virusTotalLookup,
} from "../threat-intelligence";

function response(json: unknown, status = 200): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
  };
}

describe("threat-intelligence bronclients", () => {
  it("URLhaus rapporteert een malware-host", async () => {
    const fetchFn = vi.fn(async () =>
      response({
        query_status: "ok",
        url_count: 2,
        urls: [{ threat: "malware_download", url_status: "online" }],
      }),
    ) as unknown as typeof fetch;
    const result = await urlhausLookup("example.com", "key", fetchFn);
    expect(result).toMatchObject({ queried: true, listed: true });
    expect(result.categories).toContain("malware_download");
  });

  it("Safe Browsing normaliseert threat-types", async () => {
    const fetchFn = vi.fn(async () =>
      response({ matches: [{ threatType: "MALWARE" }] }),
    ) as unknown as typeof fetch;
    const result = await safeBrowsingLookup("https://example.com/", "key", fetchFn);
    expect(result).toMatchObject({ queried: true, listed: true, categories: ["MALWARE"] });
  });

  it("VirusTotal gebruikt malicious/suspicious engine-aantallen", async () => {
    const fetchFn = vi.fn(async () =>
      response({
        data: {
          attributes: {
            last_analysis_stats: { malicious: 2, suspicious: 1, harmless: 50, undetected: 20 },
          },
        },
      }),
    ) as unknown as typeof fetch;
    const result = await virusTotalLookup("example.com", "key", fetchFn);
    expect(result).toMatchObject({ queried: true, listed: true });
    expect(result.categories).toEqual(["malicious:2", "suspicious:1"]);
  });

  it("AbuseIPDB neemt de hoogste IP-confidence en degradeert gedeeltelijke fout", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("203.0.113.11")) return response({}, 503);
      return response({ data: { abuseConfidenceScore: 80, totalReports: 12, usageType: "Data Center/Web Hosting/Transit" } });
    }) as unknown as typeof fetch;
    const result = await abuseIpdbLookup(["203.0.113.10", "203.0.113.11"], "key", fetchFn);
    expect(result).toMatchObject({ queried: true, listed: true });
    expect(result.categories).toContain("confidence:80");
  });

  it("ontbrekende key skipt alleen die bron zonder fetch", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await urlhausLookup("example.com", null, fetchFn);
    expect(result).toMatchObject({ queried: false, listed: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("createThreatIntelClient cache", () => {
  it("bevraagt een gecachete bron niet opnieuw en bewaart edge-evidence", async () => {
    const redis = fakeRedis();
    const fetchFn = vi.fn(async () =>
      response({
        data: {
          attributes: {
            last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 70, undetected: 10 },
          },
        },
      }),
    ) as unknown as typeof fetch;
    const dnsResolver = {
      resolve4: vi.fn(async () => ["203.0.113.10"]),
      resolve6: vi.fn(async () => []),
      resolveCname: vi.fn(async () => ["d111111abcdef8.cloudfront.net"]),
    } as unknown as typeof import("node:dns/promises");
    const client = createThreatIntelClient({
      keys: {
        spamhaus: null,
        urlhaus: null,
        safeBrowsing: null,
        virusTotal: "key",
        abuseIpdb: null,
      },
      redis: redis as never,
      fetchFn,
      dnsDeps: { dnsResolver },
    });

    const first = await client.lookup("example.com", "https://example.com/", "www.example.com");
    const second = await client.lookup("example.com", "https://example.com/", "www.example.com");

    expect(first.edge_detected).toBe(true);
    expect(second.sources).toEqual(first.sources);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(first.sources).toHaveLength(5);
    expect(first.sources.find((source) => source.source === "urlhaus")?.queried).toBe(false);
  });

  it("laat een falende bron de overige provideruitvoer niet blokkeren", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("urlhaus")) throw new Error("timeout");
      return response({
        data: {
          attributes: {
            last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 50, undetected: 10 },
          },
        },
      });
    }) as unknown as typeof fetch;
    const dnsResolver = {
      resolve4: vi.fn(async () => ["203.0.113.10"]),
      resolve6: vi.fn(async () => []),
      resolveCname: vi.fn(async () => []),
    } as unknown as typeof import("node:dns/promises");
    const client = createThreatIntelClient({
      keys: {
        spamhaus: null,
        urlhaus: "key",
        safeBrowsing: null,
        virusTotal: "key",
        abuseIpdb: null,
      },
      redis: null,
      fetchFn,
      dnsDeps: { dnsResolver },
    });

    const result = await client.lookup("example.com", "https://example.com/");
    expect(result.sources.find((source) => source.source === "urlhaus")).toMatchObject({
      queried: false,
      listed: false,
    });
    expect(result.sources.find((source) => source.source === "virustotal")).toMatchObject({
      queried: true,
      listed: false,
    });
  });
});
