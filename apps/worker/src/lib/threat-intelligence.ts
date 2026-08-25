import type { Redis } from "ioredis";
import {
  classifyReputation,
  reputationSchema,
  reputationSourceSchema,
  type Reputation,
  type ReputationSource,
  type ReputationSourceName,
} from "@scanpal/shared";
import {
  detectEdgeProxy,
  querySpamhausDqs,
  resolveIps,
  type DomainDeps,
} from "@scanpal/scan-core";

export const THREAT_INTEL_FETCH_TIMEOUT_MS = 7_500;
export const DEFAULT_THREAT_INTEL_CACHE_TTL_SECONDS = 12 * 60 * 60;
/** AbuseIPDB confidence-drempel waarboven een IP als "listed" telt (0–100). */
export const ABUSEIPDB_LISTED_MIN_CONFIDENCE = 25;
/**
 * Max. aantal IP-adressen dat per lookup extern bevraagd wordt. Beschermt de
 * quota van AbuseIPDB (gratis tier ~1000/dag) en Spamhaus bij domeinen met veel
 * A/AAAA-records; de volledige IP-set blijft in `reputation.ips` voor evidence.
 */
export const MAX_IPS_PER_LOOKUP = 8;

export type ThreatIntelKeys = {
  spamhaus: string | null;
  urlhaus: string | null;
  safeBrowsing: string | null;
  virusTotal: string | null;
  abuseIpdb: string | null;
};

export const THREAT_INTEL_KEY_NAMES: Record<keyof ThreatIntelKeys, string> = {
  spamhaus: "SPAMHAUS_DQS_KEY",
  urlhaus: "ABUSECH_AUTH_KEY",
  safeBrowsing: "SAFE_BROWSING_API_KEY",
  virusTotal: "VIRUSTOTAL_API_KEY",
  abuseIpdb: "ABUSEIPDB_API_KEY",
};

function unavailable(source: ReputationSourceName, detail: string): ReputationSource {
  return { source, queried: false, listed: false, detail };
}

function unconfigured(source: ReputationSourceName, key: string): ReputationSource {
  return unavailable(source, `Niet geconfigureerd (${key}).`);
}

async function jsonBody(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function numberAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function urlhausLookup(
  host: string,
  apiKey: string | null,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ReputationSource> {
  if (!apiKey) return unconfigured("urlhaus", THREAT_INTEL_KEY_NAMES.urlhaus);
  try {
    const body = new URLSearchParams({ host });
    const response = await fetchFn("https://urlhaus-api.abuse.ch/v1/host/", {
      method: "POST",
      headers: {
        "Auth-Key": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(THREAT_INTEL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return unavailable("urlhaus", `URLhaus HTTP ${response.status}.`);
    const json = (await jsonBody(response)) as {
      query_status?: unknown;
      url_count?: unknown;
      urls?: unknown;
    } | null;
    if (!json || typeof json.query_status !== "string") {
      return unavailable("urlhaus", "URLhaus gaf geen geldige JSON-response.");
    }
    if (["no_results", "invalid_host"].includes(json.query_status)) {
      return {
        source: "urlhaus",
        queried: true,
        listed: false,
        detail: "Geen malware-URL's voor deze host in URLhaus.",
      };
    }
    if (json.query_status !== "ok") {
      return unavailable("urlhaus", `URLhaus query-status: ${json.query_status}.`);
    }
    const urls = Array.isArray(json.urls) ? json.urls : [];
    const threats = new Set<string>();
    let active = 0;
    for (const item of urls) {
      const row = item as { threat?: unknown; url_status?: unknown };
      if (typeof row.threat === "string") threats.add(row.threat);
      if (row.url_status === "online") active += 1;
    }
    const count = Math.max(numberAt(json.url_count), urls.length);
    const listed = count > 0;
    return {
      source: "urlhaus",
      queried: true,
      listed,
      categories: listed
        ? [...threats, ...(active > 0 ? ["active"] : ["historical"])].sort()
        : undefined,
      detail: listed
        ? `${count} URLhaus-record(s), waarvan ${active} actief.`
        : "Geen malware-URL's voor deze host in URLhaus.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "netwerkfout";
    return unavailable("urlhaus", `URLhaus niet bereikbaar: ${message}`);
  }
}

export async function safeBrowsingLookup(
  url: string,
  apiKey: string | null,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ReputationSource> {
  if (!apiKey) return unconfigured("safe-browsing", THREAT_INTEL_KEY_NAMES.safeBrowsing);
  try {
    const response = await fetchFn(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "scanpal", clientVersion: "0.1" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(THREAT_INTEL_FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return unavailable("safe-browsing", `Safe Browsing HTTP ${response.status}.`);
    }
    const json = (await jsonBody(response)) as { matches?: unknown } | null;
    if (!json) return unavailable("safe-browsing", "Safe Browsing gaf geen geldige JSON-response.");
    const matches = Array.isArray(json.matches) ? json.matches : [];
    const categories = [
      ...new Set(
        matches
          .map((match) => (match as { threatType?: unknown }).threatType)
          .filter((value): value is string => typeof value === "string"),
      ),
    ].sort();
    return {
      source: "safe-browsing",
      queried: true,
      listed: matches.length > 0,
      categories: categories.length > 0 ? categories : undefined,
      detail:
        matches.length > 0
          ? `Google Safe Browsing-match: ${categories.join(", ")}.`
          : "Geen Safe Browsing-match.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "netwerkfout";
    return unavailable("safe-browsing", `Safe Browsing niet bereikbaar: ${message}`);
  }
}

export async function virusTotalLookup(
  host: string,
  apiKey: string | null,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ReputationSource> {
  if (!apiKey) return unconfigured("virustotal", THREAT_INTEL_KEY_NAMES.virusTotal);
  try {
    const response = await fetchFn(
      `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(host)}`,
      {
        headers: { "x-apikey": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(THREAT_INTEL_FETCH_TIMEOUT_MS),
      },
    );
    if (response.status === 404) {
      return { source: "virustotal", queried: true, listed: false, detail: "Domein onbekend bij VirusTotal." };
    }
    if (!response.ok) return unavailable("virustotal", `VirusTotal HTTP ${response.status}.`);
    const json = (await jsonBody(response)) as {
      data?: { attributes?: { last_analysis_stats?: Record<string, unknown> } };
    } | null;
    const stats = json?.data?.attributes?.last_analysis_stats;
    if (!stats) return unavailable("virustotal", "VirusTotal-response mist analysis-statistieken.");
    const malicious = numberAt(stats.malicious);
    const suspicious = numberAt(stats.suspicious);
    const harmless = numberAt(stats.harmless);
    const undetected = numberAt(stats.undetected);
    return {
      source: "virustotal",
      queried: true,
      listed: malicious + suspicious > 0,
      categories: [`malicious:${malicious}`, `suspicious:${suspicious}`],
      detail: `VirusTotal engines: malicious ${malicious}, suspicious ${suspicious}, harmless ${harmless}, undetected ${undetected}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "netwerkfout";
    return unavailable("virustotal", `VirusTotal niet bereikbaar: ${message}`);
  }
}

export async function abuseIpdbLookup(
  ips: string[],
  apiKey: string | null,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ReputationSource> {
  if (!apiKey) return unconfigured("abuseipdb", THREAT_INTEL_KEY_NAMES.abuseIpdb);
  if (ips.length === 0) return unavailable("abuseipdb", "Geen A/AAAA-adressen om te bevragen.");
  const targets = ips.slice(0, MAX_IPS_PER_LOOKUP);
  const results = await Promise.all(
    targets.map(async (ip) => {
      try {
        const params = new URLSearchParams({ ipAddress: ip, maxAgeInDays: "90" });
        const response = await fetchFn(`https://api.abuseipdb.com/api/v2/check?${params}`, {
          headers: { Key: apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(THREAT_INTEL_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return { ip, ok: false as const, detail: `HTTP ${response.status}` };
        const json = (await jsonBody(response)) as {
          data?: { abuseConfidenceScore?: unknown; totalReports?: unknown; usageType?: unknown };
        } | null;
        if (!json?.data) return { ip, ok: false as const, detail: "ongeldige JSON" };
        return {
          ip,
          ok: true as const,
          confidence: numberAt(json.data.abuseConfidenceScore),
          reports: numberAt(json.data.totalReports),
          usage: typeof json.data.usageType === "string" ? json.data.usageType : null,
        };
      } catch (err) {
        return {
          ip,
          ok: false as const,
          detail: err instanceof Error ? err.message : "netwerkfout",
        };
      }
    }),
  );
  const successful = results.filter((result): result is Extract<typeof result, { ok: true }> => result.ok);
  if (successful.length === 0) {
    return unavailable(
      "abuseipdb",
      `AbuseIPDB niet bereikbaar: ${results.map((result) => `${result.ip} ${result.detail}`).join("; ")}.`,
    );
  }
  const worst = successful.reduce((current, result) =>
    result.confidence > current.confidence ? result : current,
  );
  const listed = worst.confidence >= ABUSEIPDB_LISTED_MIN_CONFIDENCE;
  return {
    source: "abuseipdb",
    queried: true,
    listed,
    categories: [
      `confidence:${worst.confidence}`,
      `reports:${worst.reports}`,
      ...(worst.usage ? [`usage:${worst.usage}`] : []),
    ],
    detail: `${successful.length}/${targets.length} IP(s) bevraagd; hoogste confidence ${worst.confidence}% op ${worst.ip} (${worst.reports} reports).`,
  };
}

async function spamhausLookup(
  host: string,
  ips: string[],
  apiKey: string | null,
  dnsDeps: DomainDeps,
): Promise<ReputationSource> {
  if (!apiKey) return unconfigured("spamhaus", THREAT_INTEL_KEY_NAMES.spamhaus);
  const targets = [host, ...ips.slice(0, MAX_IPS_PER_LOOKUP)];
  const results = await Promise.all(
    targets.map(async (target) => ({ target, result: await querySpamhausDqs(target, apiKey, dnsDeps) })),
  );
  const successful = results.filter(({ result }) => result.queried);
  if (successful.length === 0) {
    return unavailable(
      "spamhaus",
      results.map(({ target, result }) => `${target}: ${result.detail}`).join(" "),
    );
  }
  const categories = [...new Set(successful.flatMap(({ result }) => result.categories))].sort();
  const listedTargets = successful.filter(({ result }) => result.listed).map(({ target }) => target);
  const failed = results.filter(({ result }) => !result.queried).length;
  return {
    source: "spamhaus",
    queried: true,
    listed: listedTargets.length > 0,
    categories: categories.length > 0 ? categories : undefined,
    detail:
      listedTargets.length > 0
        ? `Spamhaus-listing voor ${listedTargets.join(", ")}: ${categories.join(", ")}.${failed ? ` ${failed} query(s) mislukt.` : ""}`
        : `Spamhaus DBL/ZEN schoon voor ${successful.length} target(s).${failed ? ` ${failed} query(s) mislukt.` : ""}`,
  };
}

async function cachedSource(
  redis: Redis | null,
  ttlSeconds: number,
  source: ReputationSourceName,
  target: string,
  lookup: () => Promise<ReputationSource>,
): Promise<ReputationSource> {
  const cacheKey = `threat-intel:v1:${source}:${target}`;
  if (redis) {
    const raw = await redis.get(cacheKey).catch(() => null);
    if (raw) {
      try {
        const parsed = reputationSourceSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      } catch {
        // Cache-corruptie is een miss; de bron wordt opnieuw bevraagd.
      }
    }
  }
  const result = await lookup();
  const measured = result.queried
    ? { ...result, measured_at: new Date().toISOString() }
    : result;
  if (redis && measured.queried) {
    await redis.set(cacheKey, JSON.stringify(measured), "EX", ttlSeconds).catch(() => null);
  }
  return measured;
}

export type ThreatIntelClientOptions = {
  keys: ThreatIntelKeys;
  redis: Redis | null;
  cacheTtlSeconds?: number;
  fetchFn?: typeof fetch;
  dnsDeps?: DomainDeps;
};

export type ThreatIntelClient = ReturnType<typeof createThreatIntelClient>;

export function createThreatIntelClient(options: ThreatIntelClientOptions) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const dnsDeps = options.dnsDeps ?? {};
  const ttl = options.cacheTtlSeconds ?? DEFAULT_THREAT_INTEL_CACHE_TTL_SECONDS;

  return {
    async lookup(host: string, url: string, edgeHost = host): Promise<Reputation> {
      const [ips, edgeAtHost, edgeAtApex] = await Promise.all([
        resolveIps(host, dnsDeps),
        detectEdgeProxy(edgeHost, dnsDeps),
        edgeHost === host ? Promise.resolve(false) : detectEdgeProxy(host, dnsDeps),
      ]);
      const ipSignature = ips.join(",") || "no-ip";
      const sources = await Promise.all([
        options.keys.spamhaus
          ? cachedSource(options.redis, ttl, "spamhaus", `${host}|${ipSignature}`, () =>
              spamhausLookup(host, ips, options.keys.spamhaus, dnsDeps),
            )
          : spamhausLookup(host, ips, null, dnsDeps),
        options.keys.urlhaus
          ? cachedSource(options.redis, ttl, "urlhaus", host, () =>
              urlhausLookup(host, options.keys.urlhaus, fetchFn),
            )
          : urlhausLookup(host, null, fetchFn),
        options.keys.safeBrowsing
          ? cachedSource(options.redis, ttl, "safe-browsing", url, () =>
              safeBrowsingLookup(url, options.keys.safeBrowsing, fetchFn),
            )
          : safeBrowsingLookup(url, null, fetchFn),
        options.keys.virusTotal
          ? cachedSource(options.redis, ttl, "virustotal", host, () =>
              virusTotalLookup(host, options.keys.virusTotal, fetchFn),
            )
          : virusTotalLookup(host, null, fetchFn),
        options.keys.abuseIpdb
          ? cachedSource(options.redis, ttl, "abuseipdb", ipSignature, () =>
              abuseIpdbLookup(ips, options.keys.abuseIpdb, fetchFn),
            )
          : abuseIpdbLookup(ips, null, fetchFn),
      ]);
      const edgeDetected = edgeAtHost || edgeAtApex;
      return reputationSchema.parse({
        host,
        ips,
        edge_detected: edgeDetected,
        sources,
        worst_severity: classifyReputation(sources, edgeDetected),
        measured_at: new Date().toISOString(),
      });
    },
  };
}
