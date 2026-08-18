import type { Redis } from "ioredis";
import { cruxDataSchema, type CruxData } from "@scanpal/shared";

/**
 * Plan 62 — CrUX-client (History API). Pure REST, geen browser: de check
 * draait daardoor in de http-worker. Buitenlandse rate-limiting:
 * - Redis-cache 24u per origin (besluit 5) — max 1 API-call per origin per
 *   24u, ongeacht het aantal scans; "no data"-resultaten (404) worden
 *   meegecached (laag-verkeers-origins zijn stabiel binnen een dag).
 * - 429/andere API-fouten worden niet gecached en niet hard gegooid: de
 *   check faalt nooit hard (acceptatiecriterium).
 */

const CRUX_API_URL =
  "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord";

export const CRUX_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const CRUX_FETCH_TIMEOUT_MS = 10_000;

/** Google-drempels waartegen de histogram-buckets gefractioneerd worden. */
const FRACTION_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const;

type Vital = keyof typeof FRACTION_THRESHOLDS;

type CruxApiRecordInner = {
  key?: { origin?: string };
  collectionPeriods?: { firstDate?: { year?: number; month?: number } }[];
  metrics?: Record<string, unknown>;
};

type CruxApiRecord = {
  record?: CruxApiRecordInner;
};

export type CruxClientOptions = {
  apiKey: string | null;
  redis: Redis | null;
  fetchFn?: typeof fetch;
};

export type CruxClient = ReturnType<typeof createCruxClient>;

function clampDensity(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Fracties uit de histogram-buckets (good/needs-improvement/poor volgens de
 * Google-drempels). Buckets die over een drempel vallen worden op start/end
 * geclassificeerd — de CrUX-buckets liggen exact op de drempels, dus dit is
 * deterministisch.
 */
export function fractionsFromHistogram(
  histogram: { start?: number; end?: number; density?: number }[],
  vital: Vital,
): { good: number; needs_improvement: number; poor: number } {
  const thresholds = FRACTION_THRESHOLDS[vital];
  let good = 0;
  let needsImprovement = 0;
  let poor = 0;
  for (const bucket of histogram) {
    const density = typeof bucket.density === "number" ? bucket.density : 0;
    const start = typeof bucket.start === "number" ? bucket.start : 0;
    const end = typeof bucket.end === "number" ? bucket.end : Infinity;
    if (end <= thresholds.good) good += density;
    else if (start >= thresholds.poor) poor += density;
    else needsImprovement += density;
  }
  return {
    good: clampDensity(good),
    needs_improvement: clampDensity(needsImprovement),
    poor: clampDensity(poor),
  };
}

function padMonth(month: number | undefined): string {
  if (typeof month !== "number") return "??";
  return String(month).padStart(2, "0");
}

/** "YYYY-MM" uit de eerste collectieperiode (meest recente periode). */
export function collectionPeriodOf(
  record: CruxApiRecordInner | undefined,
): string | null {
  const period = record?.collectionPeriods?.[0];
  if (!period?.firstDate?.year) return null;
  return `${period.firstDate.year}-${padMonth(period.firstDate.month)}`;
}

/** Ruwe CrUX-response → genormaliseerd cruxData (of null bij ontbrekend/ongeldig). */
export function parseCruxResponse(body: unknown): CruxData | null {
  const record = (body as CruxApiRecord | undefined)?.record;
  if (!record?.metrics) return null;
  const origin = record.key?.origin;
  const collectionPeriod = collectionPeriodOf(record);
  if (!origin || !collectionPeriod) return null;

  const metrics: Record<string, unknown> = {};
  for (const vital of Object.keys(FRACTION_THRESHOLDS) as Vital[]) {
    const metric = record.metrics[vital] as
      | { percentiles?: { p75?: number }; histogram?: unknown[] }
      | undefined;
    const p75 = typeof metric?.percentiles?.p75 === "number" ? metric.percentiles.p75 : null;
    const fractions = fractionsFromHistogram(
      Array.isArray(metric?.histogram) ? (metric.histogram as never[]) : [],
      vital,
    );
    metrics[vital] = { p75, ...fractions };
  }

  const parsed = cruxDataSchema.safeParse({
    origin,
    collection_period: collectionPeriod,
    metrics,
  });
  return parsed.success ? parsed.data : null;
}

export function createCruxClient(options: CruxClientOptions) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const redis = options.redis;

  async function cacheGet(origin: string): Promise<CruxData | null | undefined> {
    if (!redis) return undefined;
    const raw = await redis.get(`crux:${origin}`);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as CruxData | null;
    } catch {
      return undefined;
    }
  }

  async function cacheSet(origin: string, data: CruxData | null): Promise<void> {
    if (!redis) return;
    await redis
      .set(`crux:${origin}`, JSON.stringify(data), "EX", CRUX_CACHE_TTL_SECONDS)
      .catch(() => {});
  }

  return {
    /**
     * Field-data voor één origin. Retourneert null bij: cache-miss met geen
     * data (CrUX-404), rate-limit (429), ontbrekende API-key of andere
     * API-fouten — nooit een throw (check faalt niet hard).
     */
    async fetchCrux(origin: string): Promise<CruxData | null> {
      const cached = await cacheGet(origin);
      if (cached !== undefined) return cached;

      if (!options.apiKey) return null;

      let response: Response;
      try {
        response = await fetchFn(CRUX_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": options.apiKey,
          },
          body: JSON.stringify({ origin }),
          signal: AbortSignal.timeout(CRUX_FETCH_TIMEOUT_MS),
        });
      } catch {
        return null;
      }

      if (response.status === 404) {
        await cacheSet(origin, null);
        return null;
      }
      if (response.status === 429 || !response.ok) {
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return null;
      }
      const data = parseCruxResponse(body);
      if (data) await cacheSet(origin, data);
      return data;
    },
  };
}
