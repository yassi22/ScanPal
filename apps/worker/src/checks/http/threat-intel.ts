import type { Redis } from "ioredis";
import {
  checkById,
  registrableDomain,
  type Reputation,
  type ReputationEvidence,
} from "@scanpal/shared";
import { toPunycode } from "@scanpal/scan-core";
import { env } from "../../env";
import {
  createThreatIntelClient,
  type ThreatIntelClient,
  type ThreatIntelKeys,
} from "../../lib/threat-intelligence";
import type { CheckImplementation } from "../types";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_HOST_PER_MINUTE = 5;

function keysFromEnv(): ThreatIntelKeys {
  return {
    spamhaus: env.SPAMHAUS_DQS_KEY ?? null,
    urlhaus: env.ABUSECH_AUTH_KEY ?? null,
    safeBrowsing: env.SAFE_BROWSING_API_KEY ?? null,
    virusTotal: env.VIRUSTOTAL_API_KEY ?? null,
    abuseIpdb: env.ABUSEIPDB_API_KEY ?? null,
  };
}

function hasAnyKey(keys: ThreatIntelKeys): boolean {
  return Object.values(keys).some(Boolean);
}

function safeUrl(raw: string): { host: string; lookupUrl: string } | null {
  try {
    const url = new URL(raw);
    return { host: url.hostname, lookupUrl: `${url.protocol}//${url.host}/` };
  } catch {
    return null;
  }
}

/**
 * Oudste werkelijke querytijd onder de bevraagde bronnen — de staleness-grens
 * van de meting (bronnen kunnen individueel tot de cache-TTL oud zijn). Valt
 * terug op het aggregatietijdstip als geen bron een `measured_at` draagt.
 */
function measurementTimestamp(reputation: Reputation): string {
  const stamps = reputation.sources
    .filter((source) => source.queried && source.measured_at)
    .map((source) => source.measured_at as string);
  if (stamps.length === 0) return reputation.measured_at;
  return stamps.reduce((oldest, current) => (current < oldest ? current : oldest));
}

export function summarizeReputation(reputation: Reputation): string {
  const queried = reputation.sources.filter((source) => source.queried);
  const listed = queried.filter((source) => source.listed);
  const timestamp = measurementTimestamp(reputation);
  if (queried.length === 0) {
    return `Geen reputatiebronnen geconfigureerd of bereikbaar (meting ${timestamp}); geen score-straf.`;
  }
  if (listed.length === 0) {
    return `Geen listings gevonden bij ${queried.length} bevraagde reputatiebron(nen) (meting ${timestamp}).`;
  }
  const edge = reputation.edge_detected
    ? " Edge/proxy gedetecteerd: IP-listings kunnen op het CDN-edgeadres slaan en zijn geen origin-oordeel."
    : "";
  return (
    `Listing gevonden bij ${listed.map((source) => source.source).join(", ")} (meting ${timestamp}). ` +
    `Dit is een reputatiesignaal, geen bewijs dat de site zelf malware bevat.${edge}`
  );
}

function inlineStatus(severity: Reputation["worst_severity"]): {
  status: "fail" | "warn" | "info";
  severity?: "high" | "medium" | "low";
} {
  if (severity === "high") return { status: "fail", severity: "high" };
  if (severity === "medium") return { status: "warn", severity: "medium" };
  if (severity === "low") return { status: "warn", severity: "low" };
  return { status: "info" };
}

export function createThreatIntelCheck(
  deps: { redis: Redis },
  options: { keys?: ThreatIntelKeys; client?: ThreatIntelClient } = {},
): CheckImplementation {
  const keys = options.keys ?? keysFromEnv();
  const client =
    options.client ??
    createThreatIntelClient({
      keys,
      redis: deps.redis,
      cacheTtlSeconds: env.THREAT_INTEL_CACHE_TTL_SECONDS,
    });

  return {
    id: "threat-intel",
    category: "http",
    async run(ctx) {
      const name = checkById("threat-intel")?.name ?? "Threat Intelligence & reputatie";
      const target = safeUrl(ctx.url);
      if (!target || !target.host.includes(".")) {
        return [{ id: "threat-intel", name, status: "info", detail: "Geen geldige domeinhost om te bevragen." }];
      }
      const apex = toPunycode(registrableDomain(target.host) ?? target.host);

      if (hasAnyKey(keys)) {
        const rate = await ctx.rateLimit(
          `threat-intel:${apex}`,
          RATE_LIMIT_PER_HOST_PER_MINUTE,
          RATE_LIMIT_WINDOW_SECONDS,
        );
        if (!rate.ok) {
          return [
            {
              id: "threat-intel",
              name,
              status: "info",
              detail: `Reputatiebronnen niet bevraagd door rate-limit (opnieuw over ${rate.retryAfterSeconds}s); geen score-straf.`,
            },
          ];
        }
      }

      try {
        const reputation = await client.lookup(apex, target.lookupUrl, toPunycode(target.host));
        const { status, severity } = inlineStatus(reputation.worst_severity);
        const evidence: ReputationEvidence = { kind: "threat-intel", ...reputation };
        return [
          {
            id: "threat-intel",
            name,
            status,
            severity,
            detail: summarizeReputation(reputation),
            evidence,
          },
        ];
      } catch (err) {
        const message = err instanceof Error ? err.message : "onbekende fout";
        return [
          {
            id: "threat-intel",
            name,
            status: "info",
            detail: `Threat intelligence niet controleerbaar: ${message}; geen score-straf.`,
          },
        ];
      }
    },
  };
}
