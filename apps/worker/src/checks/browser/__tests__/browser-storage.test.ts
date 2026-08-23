import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBrowserStorageCheck } from "../browser-storage";
import type { BrowserRunner, StorageRunResult } from "../runner";

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function makeRunner(result: StorageRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureStorage: vi.fn().mockResolvedValue(result),
    captureClientDeps: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBrowserStorageCheck (plan 70)", () => {
  it("info bij lege storage", async () => {
    const runner = makeRunner({ ok: true, snapshot: { local: {}, session: {} } });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("Geen");
  });

  it("fail bij service-role-key in storage", async () => {
    const runner = makeRunner({
      ok: true,
      snapshot: {
        local: { supabase: "sb_secret_abcdefghijklmnopqrstuvwxyz" },
        session: {},
      },
    });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("secret=1");
    expect(result.detail).toContain("critical");
  });

  it("warn bij JWT zonder exp", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig1234567890ab";
    const runner = makeRunner({
      ok: true,
      snapshot: { local: { token: jwt }, session: {} },
    });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("jwt=1");
  });

  it("warn bij session-token in localStorage", async () => {
    const runner = makeRunner({
      ok: true,
      snapshot: {
        local: { access_token: "opaque-value-123456" },
        session: {},
      },
    });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("session-token=1");
  });

  it("info bij alleen niet-gevoelige entries", async () => {
    const runner = makeRunner({
      ok: true,
      snapshot: { local: { theme: "dark" }, session: { temp: "x" } },
    });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("other=2");
  });

  it("evidence bevat gemaskeerde waarden, nooit volledige tokens", async () => {
    const runner = makeRunner({
      ok: true,
      snapshot: {
        local: { stripe: "sk_live_1234567890abcdefghijkl" },
        session: {},
      },
    });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    const evidence = result.evidence as { entries: { masked: string }[] };
    const masked = evidence.entries[0]!.masked;
    expect(masked).not.toContain("1234567890abcdefghijkl");
  });

  it("info bij rate-limit", async () => {
    const rate = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const runner = makeRunner({ ok: true, snapshot: { local: {}, session: {} } });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run({
      url: "https://example.com/",
      scanId: "scan-1",
      activeTests: false,
      rateLimit: rate as never,
    });
    expect(result.status).toBe("info");
    expect(result.detail).toContain("rate-limit");
  });

  it("info bij capture-fout (geen storing)", async () => {
    const runner = makeRunner({ ok: false, error: "page timeout" });
    const check = createBrowserStorageCheck(runner);
    const [result] = await check.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("mislukt");
  });
});
