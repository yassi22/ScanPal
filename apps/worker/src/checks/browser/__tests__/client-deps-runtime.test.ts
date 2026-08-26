import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClientDepsRuntimeCheck } from "../client-deps-runtime";
import type { BrowserRunner, ClientDepsRunResult } from "../runner";
import type { OsvVulnerability } from "@scanpal/shared";

function makeRunner(capture: ClientDepsRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn(),
    runAxe: vi.fn(),
    captureConsole: vi.fn(),
    captureResponsive: vi.fn(),
    captureRenderCompare: vi.fn(),
    captureStorage: vi.fn(),
    captureClientDeps: vi.fn().mockResolvedValue(capture),
    captureAuthFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureUploadFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  } as unknown as BrowserRunner;
}

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

const vulns: OsvVulnerability[] = [
  {
    id: "GHSA-critical",
    package_name: "jquery",
    ecosystem: "npm",
    version: "3.4.1",
    summary: "xss",
    severity: "critical",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createClientDepsRuntimeCheck (plan 71 v2)", () => {
  it("info bij een mislukte capture", async () => {
    const runner = makeRunner({ ok: false, error: "browser crash" });
    const check = createClientDepsRuntimeCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("Runtime-deps-capture mislukt");
  });

  it("pass wanneer geen libs met versie gevonden worden", async () => {
    const runner = makeRunner({ ok: true, capture: { jquery: null, react: null } });
    const check = createClientDepsRuntimeCheck(runner, {
      queryOsv: vi.fn(),
    });
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Geen bekende JS-libs met versie");
  });

  it("fail bij critical CVE via runtime-global (URL-only, geen repo)", async () => {
    const runner = makeRunner({ ok: true, capture: { jquery: "3.4.1" } });
    const queryOsv = vi.fn().mockResolvedValue([vulns]);
    const check = createClientDepsRuntimeCheck(runner, { queryOsv });
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "client-deps",
      total: 1,
      vulnerable: 1,
      by_severity: expect.objectContaining({ critical: 1 }),
    });
    if (
      !result.evidence ||
      typeof result.evidence !== "object" ||
      !("kind" in result.evidence) ||
      result.evidence.kind !== "client-deps"
    ) {
      throw new Error("client-deps evidence verwacht");
    }
    expect(result.evidence.samples[0]?.source).toBe("runtime-global");
    expect(queryOsv).toHaveBeenCalledTimes(1);
    expect(queryOsv.mock.calls[0][0]).toEqual([
      { package: { name: "jquery", ecosystem: "npm" }, version: "3.4.1" },
    ]);
  });

  it("pass wanneer runtime-deps bevestigd maar zonder bekende vulns", async () => {
    const runner = makeRunner({ ok: true, capture: { react: "17.0.2" } });
    const queryOsv = vi.fn().mockResolvedValue([[]]);
    const check = createClientDepsRuntimeCheck(runner, { queryOsv });
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("geen bekende kwetsbaarheden");
    expect(result.evidence).toBeNull();
  });

  it("warn bij rate-limit op OSV", async () => {
    const runner = makeRunner({ ok: true, capture: { jquery: "3.4.1" } });
    const queryOsv = vi.fn();
    const check = createClientDepsRuntimeCheck(runner, { queryOsv });
    const [result] = await check.run({
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(queryOsv).not.toHaveBeenCalled();
  });

  it("eigen check-id, geen collision met client-deps-cve", async () => {
    const runner = makeRunner({ ok: true, capture: { lodash: "4.17.20" } });
    const check = createClientDepsRuntimeCheck(runner, {
      queryOsv: vi.fn().mockResolvedValue([[]]),
    });
    const [result] = await check.run(ctx());
    expect(result.id).toBe("client-deps-runtime");
    expect(result.id).not.toBe("client-deps-cve");
  });
});
