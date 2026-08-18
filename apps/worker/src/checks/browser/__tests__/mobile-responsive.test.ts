import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMobileResponsiveCheck } from "../mobile-responsive";
import type { BrowserRunner, ResponsiveRunResult } from "../runner";

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function makeRunner(result: ResponsiveRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureResponsive: vi.fn().mockResolvedValue(result),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  };
}

const okMobile = { width: 375, height: 667, horizontal_scroll: false, overflow_px: 0 };
const okDesktop = { width: 1280, height: 720, horizontal_scroll: false, overflow_px: 0 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createMobileResponsiveCheck (feature 45)", () => {
  it("fail bij significante mobile-overflow", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        mobile: { ...okMobile, horizontal_scroll: true, overflow_px: 25 },
        desktop: okDesktop,
        tap_target_issues: [],
      },
    });
    const check = createMobileResponsiveCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "mobile-responsive",
      mobile: { overflow_px: 25 },
    });
    expect(result.detail).toContain("Horizontale scroll op mobile");
  });

  it("warn bij tap-target-issues", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        mobile: okMobile,
        desktop: okDesktop,
        tap_target_issues: [{ selector: "button.small", width_px: 18, height_px: 18 }],
      },
    });
    const check = createMobileResponsiveCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatchObject({ tap_target_issues: 1 });
  });

  it("pass bij alles goed", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        mobile: okMobile,
        desktop: okDesktop,
        tap_target_issues: [],
      },
    });
    const check = createMobileResponsiveCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("zonder layout-issues");
  });

  it("warn als capture faalt", async () => {
    const runner = makeRunner({ ok: false, error: "browser launch failed" });
    const check = createMobileResponsiveCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Responsive-capture mislukt");
    expect(result.evidence).toBeUndefined();
  });

  it("warn bij onvolledige viewport-data", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        mobile: { width: 0, height: 0, horizontal_scroll: false, overflow_px: 0 },
        desktop: okDesktop,
        tap_target_issues: [],
      },
    });
    const check = createMobileResponsiveCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("onvolledige viewport-data");
  });

  it("warn: rate-limit bereikt slaat check over", async () => {
    const runner = makeRunner({
      ok: true,
      capture: { mobile: okMobile, desktop: okDesktop, tap_target_issues: [] },
    });
    const check = createMobileResponsiveCheck(runner);
    const rateCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };
    const [result] = await check.run(rateCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(runner.captureResponsive).not.toHaveBeenCalled();
  });

  it("roept runner.captureResponsive met de ctx.url", async () => {
    const runner = makeRunner({
      ok: true,
      capture: { mobile: okMobile, desktop: okDesktop, tap_target_issues: [] },
    });
    const check = createMobileResponsiveCheck(runner);
    await check.run(ctx("https://example.com/path"));
    expect(runner.captureResponsive).toHaveBeenCalledWith("https://example.com/path");
  });
});
