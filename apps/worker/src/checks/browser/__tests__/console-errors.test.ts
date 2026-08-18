import { describe, it, expect, vi, beforeEach } from "vitest";
import { createConsoleErrorsCheck } from "../console-errors";
import type { BrowserRunner, ConsoleRunResult } from "../runner";

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function makeRunner(result: ConsoleRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureConsole: vi.fn().mockResolvedValue(result),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createConsoleErrorsCheck (feature 44)", () => {
  it("fail bij console-error", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        messages: [{ type: "error", text: "Uncaught TypeError" }],
        failed_requests: [],
      },
    });
    const check = createConsoleErrorsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "console-errors",
      by_type: { error: 1 },
      failed_requests: 0,
    });
    expect(result.detail).toContain("1 message(s)");
  });

  it("fail bij failed-request zonder console-errors", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        messages: [],
        failed_requests: [{ url: "https://api.example.com/x", method: "POST", status: 500 }],
      },
    });
    const check = createConsoleErrorsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({ failed_requests: 1 });
  });

  it("warn bij alleen warnings", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        messages: [{ type: "warning", text: "deprecation" }],
        failed_requests: [],
      },
    });
    const check = createConsoleErrorsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
  });

  it("pass bij alleen info-messages", async () => {
    const runner = makeRunner({
      ok: true,
      capture: {
        messages: [{ type: "info", text: "hello" }],
        failed_requests: [],
      },
    });
    const check = createConsoleErrorsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("1 message(s)");
    expect(result.detail).toContain("error=0");
  });

  it("warn als capture faalt", async () => {
    const runner = makeRunner({ ok: false, error: "browser launch failed" });
    const check = createConsoleErrorsCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Console-capture mislukt");
    expect(result.evidence).toBeUndefined();
  });

  it("warn: rate-limit bereikt slaat check over", async () => {
    const runner = makeRunner({
      ok: true,
      capture: { messages: [], failed_requests: [] },
    });
    const check = createConsoleErrorsCheck(runner);
    const rateCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };
    const [result] = await check.run(rateCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(runner.captureConsole).not.toHaveBeenCalled();
  });

  it("roept runner.captureConsole met de ctx.url", async () => {
    const runner = makeRunner({
      ok: true,
      capture: { messages: [], failed_requests: [] },
    });
    const check = createConsoleErrorsCheck(runner);
    await check.run(ctx("https://example.com/path"));
    expect(runner.captureConsole).toHaveBeenCalledWith("https://example.com/path");
  });
});
