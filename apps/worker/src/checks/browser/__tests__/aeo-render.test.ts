import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAeoRenderCheck } from "../aeo-render";
import type { BrowserRunner, RenderRunResult } from "../runner";

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

const passCapture = {
  server: { text_length: 600, heading_count: 2, title: "Titel", meta_description: "Meta", link_count: 5 },
  rendered: { text_length: 650, heading_count: 2, title: "Titel", meta_description: "Meta", link_count: 6 },
};

function makeRunner(result: RenderRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureRenderCompare: vi.fn().mockResolvedValue(result),
    captureStorage: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureClientDeps: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureAuthFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureUploadFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAeoRenderCheck (feature 43)", () => {
  it("pass bij parseerbare server-HTML (geen JS-afhankelijkheid)", async () => {
    const runner = makeRunner({ ok: true, capture: passCapture });
    const check = createAeoRenderCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("zonder JavaScript beschikbaar");
    expect(result.evidence).toMatchObject({
      kind: "aeo-render",
      server: { text_length: 600 },
      rendered: { text_length: 650 },
    });
  });

  it("fail bij SPA-shell (leeg server-HTML, volle DOM)", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        server: { text_length: 40, heading_count: 0, title: null, meta_description: null, link_count: 0 },
        rendered: { text_length: 2000, heading_count: 4, title: "SPA", meta_description: "m", link_count: 10 },
      },
    });
    const check = createAeoRenderCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("JavaScript");
  });

  it("warn bij grote JS-afhankelijkheid (ratio ≥ 3)", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        server: { text_length: 200, heading_count: 1, title: "T", meta_description: null, link_count: 1 },
        rendered: { text_length: 900, heading_count: 2, title: "T", meta_description: "m", link_count: 3 },
      },
    });
    const check = createAeoRenderCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatchObject({ text_ratio: 4.5 });
  });

  it("warn als capture faalt", async () => {
    const runner = makeRunner({ ok: false, error: "request timeout" });
    const check = createAeoRenderCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Render-vergelijking mislukt");
    expect(result.evidence).toBeUndefined();
  });

  it("warn bij onvolledige capture-data", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        server: { text_length: 100, heading_count: 0, title: null, meta_description: null, link_count: 0 },
        rendered: null as never,
      },
    });
    const check = createAeoRenderCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("onvolledige data");
  });

  it("warn: rate-limit bereikt slaat check over", async () => {
    const runner = makeRunner({ ok: true, capture: passCapture });
    const check = createAeoRenderCheck(runner);
    const rateCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };
    const [result] = await check.run(rateCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(runner.captureRenderCompare).not.toHaveBeenCalled();
  });

  it("roept runner.captureRenderCompare met de ctx.url", async () => {
    const runner = makeRunner({ ok: true, capture: passCapture });
    const check = createAeoRenderCheck(runner);
    await check.run(ctx("https://example.com/path"));
    expect(runner.captureRenderCompare).toHaveBeenCalledWith("https://example.com/path");
  });
});
