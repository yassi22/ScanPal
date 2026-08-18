import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedIp } from "@scanpal/notify";
import type { InlineCheckLike, ScanCategory } from "@scanpal/shared";
import type { RateLimiter } from "../rate-limit";

/**
 * Check-contract (plan 27, besluit 8): één check = catalog-entry (id +
 * categorie in packages/shared) + implementatie hier in de worker. Elke
 * implementatie retourneert `InlineCheckLike[]` — dezelfde vorm als de
 * (tijdelijke) inline probe — zodat de worker ze 1-op-1 omzet naar
 * v1-findings (shared `inlineChecksToFindings`) en per check een
 * `checks`-rij + atomic progress schrijft.
 */
export type CheckContext = {
  /** Canonical page-URL (https://host/path). */
  url: string;
  scanId: string;
  /** Plan 52: actieve vulnerability-tests alleen bij expliciete opt-in. */
  activeTests: boolean;
  /** Per-host Redis rate-limit (verplicht voor elke outbound check). */
  rateLimit: RateLimiter;
  /**
   * Features 46–49: GitHub-repo-slug (`owner/repo` of URL) voor de github-
   * worker. Alleen gezet wanneer `sites.github_repo` is ingevuld (de
   * dispatcher includeert de github-queue alleen dan). http/browser-checks
   * negeren dit veld.
   */
  githubRepo?: string | null;
};

export type CheckImplementation = {
  id: string;
  category: ScanCategory;
  run(ctx: CheckContext): Promise<InlineCheckLike[]>;
};

export const USER_AGENT = "ScanPal/0.1 (+https://scanpal.dev)";

/** Max redirects die fetchPage volgt (redirect-hops worden óók SSRF-geguard). */
export const MAX_REDIRECTS = 5;
/** Standaard byte-cap op response-bodies (5 MB, zelfde orde als BUNDLE_SCAN_LIMITS). */
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** DNS-cache per host (60s) — voorkomt DNS-hammering per fetch. */
const DNS_CACHE_TTL_MS = 60_000;
const dnsCache = new Map<string, { addresses: string[]; at: number }>();

async function resolveHost(host: string): Promise<string[] | null> {
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.at < DNS_CACHE_TTL_MS) {
    return cached.addresses;
  }
  try {
    const addresses = (await lookup(host, { all: true })).map((a) => a.address);
    dnsCache.set(host, { addresses, at: Date.now() });
    return addresses;
  } catch {
    return null;
  }
}

/**
 * SSRF-guard voor alle outbound fetches van de worker: protocol http/https,
 * geen localhost/.local/.internal, en geen IP-bereik dat naar loopback/private/
 * link-local wijst (incl. DNS-resolutie → anti-rebinding). Anders dan de
 * webhook-deliverer staat http:// toe (de scanner onderzoekt bewust http-only
 * sites); private/metadata-targets zijn altijd geblokkeerd.
 */
export async function assertOutboundAllowed(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "invalid-url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "protocol";
  }
  const rawHost = parsed.hostname.toLowerCase();
  // URL.hostname houdt bij IPv6 de brackets aan ("[::1]") — strip ze voor isIP().
  const host = rawHost.startsWith("[") && rawHost.endsWith("]")
    ? rawHost.slice(1, -1)
    : rawHost;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "localhost";
  }
  const ipVersion = isIP(host);
  if (ipVersion !== 0) {
    return isBlockedIp(host) ? "blocked-ip" : null;
  }
  const addresses = await resolveHost(host);
  if (addresses === null) return "dns-failure";
  for (const address of addresses) {
    if (isBlockedIp(address)) return "resolved-blocked-ip";
  }
  return null;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Redirect-ketting per response (voor checks die het `location`-gedrag van de
 * site willen inspecteren, bijv. open-redirect-detectie). Keyed op het
 * Response-object zodat de originele response-gegevens beschikbaar blijven
 * terwijl fetchPage de redirects zelf volgt (SSRF-geguard).
 */
const redirectChains = new WeakMap<Response, string[]>();

export function redirectChainOf(response: Response): string[] {
  return redirectChains.get(response) ?? [];
}

/** Vervangt de body door een byte-getelde stream (drukt de cap door naar `.text()`). */
function withBodyLimit(response: Response, maxBytes: number): Response {
  if (!response.body || !maxBytes) return response;
  const reader = response.body.getReader();
  let received = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          controller.error(
            new Error(`response body exceeds ${maxBytes} bytes`),
          );
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Eén fetch met timeout, redirect-follow (per hop SSRF-geguard) en een
 * byte-cap op de body; alle outbound HTTP-checks in de worker gaan hierdoorheen
 * (politeness: callers reguleren hun eigen tempo).
 */
export async function fetchPage(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    maxBytes?: number;
  } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10000,
  );
  try {
    let current = url;
    let redirects = 0;
    const chain: string[] = [];
    for (;;) {
      const blocked = await assertOutboundAllowed(current);
      if (blocked) {
        throw new Error(`outbound fetch blocked (${blocked}): ${current}`);
      }
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, ...options.headers },
      });
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) return response;
        current = new URL(location, current).toString();
        chain.push(current);
        await response.body?.cancel().catch(() => {});
        if (++redirects > MAX_REDIRECTS) {
          throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
        }
        continue;
      }
      const limited = withBodyLimit(response, options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
      redirectChains.set(limited, chain);
      return limited;
    }
  } finally {
    clearTimeout(timer);
  }
}
