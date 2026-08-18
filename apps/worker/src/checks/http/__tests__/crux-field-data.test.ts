import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CruxData } from "@scanpal/shared";

vi.mock("../../../lib/crux", () => ({ createCruxClient: vi.fn() }));
vi.mock("../../../env", () => ({ env: { CRUX_API_KEY: undefined } }));
vi.mock("@scanpal/scan-core", () => ({ writeScanCrux: vi.fn() }));

import { createCruxFieldDataCheck, summarizeCrux } from "../crux-field-data";
import { createCruxClient } from "../../../lib/crux";
import { env } from "../../../env";
import { writeScanCrux } from "@scanpal/scan-core";

const mockedCreateClient = vi.mocked(createCruxClient);
const mockedWriteCrux = vi.mocked(writeScanCrux);

const SAMPLE_CRUX: CruxData = {
  origin: "https://example.com",
  collection_period: "2026-07",
  metrics: {
    lcp: { p75: 2100, good: 0.7, needs_improvement: 0.2, poor: 0.1 },
    inp: { p75: 180, good: 0.8, needs_improvement: 0.15, poor: 0.05 },
    cls: { p75: 0.05, good: 0.85, needs_improvement: 0.1, poor: 0.05 },
  },
};

function setupCheck(fetchCrux: () => Promise<CruxData | null>) {
  mockedCreateClient.mockReturnValue({ fetchCrux } as never);
  return createCruxFieldDataCheck({ redis: {}, db: {} } as never);
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.CRUX_API_KEY = "test-key";
});

describe("createCruxFieldDataCheck (plan 62)", () => {
  it("met field data → pass-finding met evidence en scans.crux-write", async () => {
    const check = setupCheck(() => Promise.resolve(SAMPLE_CRUX));
    const results = await check.run(ctx());
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].id).toBe("crux-field-data");
    expect(results[0].evidence).toEqual({ kind: "crux-field-data", data: SAMPLE_CRUX });
    expect(mockedWriteCrux).toHaveBeenCalledWith(
      expect.anything(),
      "scan-1",
      SAMPLE_CRUX,
    );
  });

  it("geen data → info-finding zonder score-straf (crux null)", async () => {
    const check = setupCheck(() => Promise.resolve(null));
    const results = await check.run(ctx());
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("Geen CrUX field data");
    expect(mockedWriteCrux).toHaveBeenCalledWith(expect.anything(), "scan-1", null);
  });

  it("zonder API-key → info-finding, geen client-call", async () => {
    env.CRUX_API_KEY = undefined;
    const check = setupCheck(() => Promise.resolve(SAMPLE_CRUX));
    const results = await check.run(ctx());
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("API-key");
    expect(mockedCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: null }),
    );
    expect(mockedWriteCrux).toHaveBeenCalledWith(expect.anything(), "scan-1", null);
  });

  it("client-throw → info-finding (check faalt niet hard), crux null", async () => {
    const check = setupCheck(() => Promise.reject(new Error("boom")));
    const results = await check.run(ctx());
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("boom");
    expect(mockedWriteCrux).toHaveBeenCalledWith(expect.anything(), "scan-1", null);
  });

  it("client wordt aangemaakt met de env-key en redis", async () => {
    setupCheck(() => Promise.resolve(SAMPLE_CRUX));
    expect(mockedCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-key", redis: {} }),
    );
  });
});

describe("summarizeCrux", () => {
  it("bevat p75 + fracties per vital en de periode", () => {
    const summary = summarizeCrux(SAMPLE_CRUX);
    expect(summary).toContain("Periode 2026-07");
    expect(summary).toContain("LCP p75 2100ms");
    expect(summary).toContain("good 70%");
    expect(summary).toContain("INP p75 180ms");
    expect(summary).toContain("CLS p75 0.05");
  });
});
