import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAccessibilityCheck } from "../accessibility";
import type { BrowserRunner, AxeRunResult } from "../runner";

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function makeRunner(result: AxeRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue(result),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  };
}

const sampleViolations = [
  {
    id: "color-contrast",
    impact: "critical",
    help: "Elements must have sufficient color contrast",
    tags: ["cat.color"],
    nodes: [{ target: ["button.primary"], html: "<button>click</button>" }],
  },
  {
    id: "image-alt",
    impact: "serious",
    help: "Images must have alternate text",
    tags: ["cat.text-alternatives"],
    nodes: [{ target: ["img.hero"], html: "<img>" }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAccessibilityCheck (feature 42)", () => {
  it("fail bij critical/serious violations", async () => {
    const runner = makeRunner({ ok: true, violations: sampleViolations });
    const check = createAccessibilityCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "accessibility",
      total: 2,
      by_impact: { critical: 1, serious: 1, moderate: 0, minor: 0 },
    });
    expect(result.detail).toContain("2 violation(s)");
  });

  it("warn bij alleen moderate/minor", async () => {
    const runner = makeRunner({
      ok: true,
      violations: [
        {
          id: "heading-order",
          impact: "moderate",
          help: "Heading levels should only increase by one",
          tags: [],
          nodes: [{ target: ["h3.skip"] }],
        },
      ],
    });
    const check = createAccessibilityCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatchObject({
      by_impact: { moderate: 1 },
    });
  });

  it("pass bij geen violations", async () => {
    const runner = makeRunner({ ok: true, violations: [] });
    const check = createAccessibilityCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "accessibility", total: 0 });
    expect(result.detail).toContain("Geen axe-core-violations");
  });

  it("warn als axe-run faalt", async () => {
    const runner = makeRunner({ ok: false, error: "browser launch failed" });
    const check = createAccessibilityCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("axe-run mislukt");
    expect(result.evidence).toBeUndefined();
  });

  it("warn: rate-limit bereikt slaat check over", async () => {
    const runner = makeRunner({ ok: true, violations: [] });
    const check = createAccessibilityCheck(runner);
    const rateCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };
    const [result] = await check.run(rateCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(runner.runAxe).not.toHaveBeenCalled();
  });

  it("roept runner.runAxe met de ctx.url", async () => {
    const runner = makeRunner({ ok: true, violations: [] });
    const check = createAccessibilityCheck(runner);
    await check.run(ctx("https://example.com/path"));
    expect(runner.runAxe).toHaveBeenCalledWith("https://example.com/path");
  });
});
