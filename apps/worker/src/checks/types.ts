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
};

export type CheckImplementation = {
  id: string;
  category: ScanCategory;
  run(ctx: CheckContext): Promise<InlineCheckLike[]>;
};

export const USER_AGENT = "ScanPal/0.1 (+https://scanpal.dev)";

/**
 * Eén fetch met timeout en redirect-follow; alle outbound HTTP-checks in de
 * worker gaan hierdoorheen (politeness: callers reguleren hun eigen tempo).
 */
export async function fetchPage(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10000,
  );
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...options.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}