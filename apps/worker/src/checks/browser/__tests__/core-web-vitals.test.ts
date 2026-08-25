import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCoreWebVitalsCheck } from "../core-web-vitals";
import type { BrowserRunner, BrowserRunResult } from "../runner";

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function makeRunner(result: BrowserRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue(result),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "not-used" }),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "not-used" }),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "not-used" }),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "not-used" }),
    captureStorage: vi.fn().mockResolvedValue({ ok: false, error: "not-used" }),
    captureClientDeps: vi.fn().mockResolvedValue({ ok: false, error: "not-used" }),
    captureAuthFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureUploadFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCoreWebVitalsCheck (feature 41)", () => {
  it("pass: alles good", async () => {
    const runner = makeRunner({ ok: true, metrics: { lcp_ms: 1000, cls: 0.05, inp_ms: 100 } });
    const check = createCoreWebVitalsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({
      kind: "core-web-vitals",
      ratings: { lcp: "good", cls: "good", inp: "good" },
    });
    expect(result.detail).toContain("LCP=1000ms");
  });

  it("warn: needs-improvement metrics", async () => {
    const runner = makeRunner({ ok: true, metrics: { lcp_ms: 3000, cls: 0.15, inp_ms: 250 } });
    const check = createCoreWebVitalsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatchObject({
      ratings: { lcp: "needs-improvement", cls: "needs-improvement", inp: "needs-improvement" },
    });
  });

  it("fail: een poor-metric", async () => {
    const runner = makeRunner({ ok: true, metrics: { lcp_ms: 5000, cls: 0.05, inp_ms: 100 } });
    const check = createCoreWebVitalsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({ ratings: { lcp: "poor" } });
  });

  it("pass met null metrics (unknown → geen fail)", async () => {
    const runner = makeRunner({ ok: true, metrics: { lcp_ms: null, cls: null, inp_ms: null } });
    const check = createCoreWebVitalsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Geen Core Web Vitals-metrics");
  });

  it("warn als browser-run faalt", async () => {
    const runner = makeRunner({ ok: false, error: "launch timeout" });
    const check = createCoreWebVitalsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Browser-run mislukt");
    expect(result.detail).toContain("launch timeout");
    expect(result.evidence).toBeUndefined();
  });

  it("warn: rate-limit bereikt slaat de check over", async () => {
    const runner = makeRunner({ ok: true, metrics: { lcp_ms: 1000, cls: 0.05, inp_ms: 100 } });
    const check = createCoreWebVitalsCheck(runner);
    const rateCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };
    const [result] = await check.run(rateCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(runner.captureVitals).not.toHaveBeenCalled();
  });

  it("roept runner.captureVitals met de ctx.url", async () => {
    const runner = makeRunner({ ok: true, metrics: { lcp_ms: 1000, cls: 0.05, inp_ms: 100 } });
    const check = createCoreWebVitalsCheck(runner);
    await check.run(ctx("https://example.com/some/path"));
    expect(runner.captureVitals).toHaveBeenCalledWith("https://example.com/some/path");
  });
});
