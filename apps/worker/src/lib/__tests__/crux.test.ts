import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  collectionPeriodOf,
  createCruxClient,
  fractionsFromHistogram,
  parseCruxResponse,
} from "../crux";
import { cruxDataSchema } from "@scanpal/shared";

const API_BODY = {
  record: {
    key: { origin: "https://example.com" },
    collectionPeriods: [
      {
        firstDate: { year: 2026, month: 7 },
        lastDate: { year: 2026, month: 7 },
      },
    ],
    metrics: {
      lcp: {
        percentiles: { p75: 2100 },
        histogram: [
          { start: 0, end: 2500, density: 0.7 },
          { start: 2500, end: 4000, density: 0.2 },
          { start: 4000, density: 0.1 },
        ],
      },
      inp: {
        percentiles: { p75: 180 },
        histogram: [
          { start: 0, end: 200, density: 0.8 },
          { start: 200, end: 500, density: 0.15 },
          { start: 500, density: 0.05 },
        ],
      },
      cls: {
        percentiles: { p75: 0.05 },
        histogram: [
          { start: 0, end: 0.1, density: 0.85 },
          { start: 0.1, end: 0.25, density: 0.1 },
          { start: 0.25, density: 0.05 },
        ],
      },
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fractionsFromHistogram", () => {
  it("classificeert buckets exact op de drempels", () => {
    const fractions = fractionsFromHistogram(
      [
        { start: 0, end: 2500, density: 0.7 },
        { start: 2500, end: 4000, density: 0.2 },
        { start: 4000, density: 0.1 },
      ],
      "lcp",
    );
    expect(fractions).toEqual({
      good: 0.7,
      needs_improvement: 0.2,
      poor: 0.1,
    });
  });

  it("open einde (laatste bucket) telt als poor", () => {
    const fractions = fractionsFromHistogram(
      [{ start: 4000, density: 0.25 }],
      "inp",
    );
    expect(fractions.poor).toBe(0.25);
  });

  it("lege histogram → nullen", () => {
    expect(fractionsFromHistogram([], "cls")).toEqual({
      good: 0,
      needs_improvement: 0,
      poor: 0,
    });
  });

  it("dichtheid buiten 0..1 wordt geclampt", () => {
    const fractions = fractionsFromHistogram(
      [{ start: 0, end: 2500, density: 1.5 }],
      "lcp",
    );
    expect(fractions.good).toBe(1);
  });
});

describe("parseCruxResponse", () => {
  it("normaliseert een volledige History-API-response", () => {
    const data = parseCruxResponse(API_BODY);
    expect(data).not.toBeNull();
    const parsed = cruxDataSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    expect(data!.origin).toBe("https://example.com");
    expect(data!.collection_period).toBe("2026-07");
    expect(data!.metrics.lcp.p75).toBe(2100);
    expect(data!.metrics.lcp.good).toBe(0.7);
    expect(data!.metrics.inp.p75).toBe(180);
    expect(data!.metrics.cls.p75).toBe(0.05);
  });

  it("zonder record.metrics → null", () => {
    expect(parseCruxResponse({ record: { key: { origin: "https://x.nl" } } })).toBeNull();
  });

  it("zonder origin of periode → null", () => {
    const body = { record: { metrics: { lcp: { percentiles: { p75: 1 } } } } };
    expect(parseCruxResponse(body)).toBeNull();
  });

  it("fractionele p75 (bijv. CLS) blijft bewaard", () => {
    const data = parseCruxResponse({
      record: {
        key: { origin: "https://example.com" },
        collectionPeriods: [
          { firstDate: { year: 2026, month: 7 } },
        ],
        metrics: {
          lcp: { percentiles: { p75: 1800 }, histogram: [] },
          inp: { percentiles: { p75: 150 }, histogram: [] },
          cls: { percentiles: { p75: 0.012 }, histogram: [] },
        },
      },
    });
    expect(data!.metrics.cls.p75).toBe(0.012);
  });
});

describe("collectionPeriodOf", () => {
  it("formatteert YYYY-MM met zero-padded maand", () => {
    expect(collectionPeriodOf({ collectionPeriods: [{ firstDate: { year: 2026, month: 2 } }] })).toBe("2026-02");
  });

  it("zonder periode → null", () => {
    expect(collectionPeriodOf({})).toBeNull();
  });
});

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

describe("createCruxClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("200 met data → genormaliseerd cruxData", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(API_BODY));
    const client = createCruxClient({ apiKey: "key", redis: null, fetchFn });
    const data = await client.fetchCrux("https://example.com");
    expect(data).not.toBeNull();
    expect(data!.metrics.lcp.p75).toBe(2100);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("404 (geen data) → null", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 404, message: "chrome ux report data not found" } }, 404),
    );
    const client = createCruxClient({ apiKey: "key", redis: null, fetchFn });
    expect(await client.fetchCrux("https://example.com")).toBeNull();
  });

  it("429 → null en niet gecached", async () => {
    const redis = fakeRedis();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 429 } }, 429));
    const client = createCruxClient({ apiKey: "key", redis: redis as never, fetchFn });
    expect(await client.fetchCrux("https://example.com")).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("5xx → null en niet gecached", async () => {
    const redis = fakeRedis();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 500));
    const client = createCruxClient({ apiKey: "key", redis: redis as never, fetchFn });
    expect(await client.fetchCrux("https://example.com")).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("zonder API-key → null zonder API-call", async () => {
    const fetchFn = vi.fn();
    const client = createCruxClient({ apiKey: null, redis: null, fetchFn });
    expect(await client.fetchCrux("https://example.com")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("cached resultaat → tweede call gebruikt de cache (geen API-call)", async () => {
    const redis = fakeRedis();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(API_BODY));
    const client = createCruxClient({ apiKey: "key", redis: redis as never, fetchFn });
    const first = await client.fetchCrux("https://example.com");
    const second = await client.fetchCrux("https://example.com");
    expect(first).toEqual(second);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it("no-data (404) wordt gecached → geen herhaalde API-calls", async () => {
    const redis = fakeRedis();
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 404 } }, 404));
    const client = createCruxClient({ apiKey: "key", redis: redis as never, fetchFn });
    expect(await client.fetchCrux("https://example.com")).toBeNull();
    expect(await client.fetchCrux("https://example.com")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("network-error → null zonder throw", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createCruxClient({ apiKey: "key", redis: null, fetchFn });
    expect(await client.fetchCrux("https://example.com")).toBeNull();
  });
});
