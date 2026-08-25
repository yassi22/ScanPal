import { describe, it, expect, vi, beforeEach } from "vitest";
import { wafResilienceCheck } from "../waf-resilience";

vi.mock("../../types", async () => {
  const actual = await vi.importActual("../../types");
  return { ...actual, fetchPage: vi.fn() };
});

import { fetchPage } from "../../types";
const mockedFetchPage = vi.mocked(fetchPage);

function mockResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response("body", { status, headers });
}

function ctx(url = "https://example.com") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  } as never;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("wafResilienceCheck (run)", () => {
  it("info bij Cloudflare + rate-limit-headers", async () => {
    mockedFetchPage.mockResolvedValue(
      mockResponse(200, {
        "cf-ray": "abc123",
        "x-ratelimit-remaining": "42",
      }),
    );
    const r = await wafResilienceCheck.run(ctx());
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("Cloudflare");
    expect(r[0].evidence).toMatchObject({ kind: "waf-resilience", cdn: "Cloudflare" });
  });

  it("warn/low bij geen WAF/CDN en geen rate-limit-headers", async () => {
    mockedFetchPage.mockResolvedValue(
      mockResponse(200, { "content-type": "text/html" }),
    );
    const r = await wafResilienceCheck.run(ctx());
    expect(r[0].status).toBe("warn");
    expect(r[0].severity).toBe("low");
    expect(r[0].detail).toContain("Geen WAF/CDN");
  });

  it("info bij 429 op de bestaande fetch", async () => {
    mockedFetchPage.mockResolvedValue(
      mockResponse(429, { "retry-after": "60" }),
    );
    const r = await wafResilienceCheck.run(ctx());
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("429");
  });

  it("info bij alleen rate-limit-headers (geen WAF/CDN)", async () => {
    mockedFetchPage.mockResolvedValue(
      mockResponse(200, { "x-ratelimit-remaining": "5" }),
    );
    const r = await wafResilienceCheck.run(ctx());
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("Rate-limit-headers");
  });

  it("warn bij fetch-fout", async () => {
    mockedFetchPage.mockRejectedValue(new Error("network down"));
    const r = await wafResilienceCheck.run(ctx());
    expect(r[0].status).toBe("warn");
    expect(r[0].detail).toContain("niet uitvoerbaar");
  });

  it("hergebruikt ctx.fetchPage indien aanwezig (geen extra fetch)", async () => {
    const shared = vi.fn().mockResolvedValue(
      mockResponse(200, { "cf-ray": "x" }),
    );
    const r = await wafResilienceCheck.run({
      url: "https://example.com",
      scanId: "scan-1",
      activeTests: false,
      rateLimit: vi.fn().mockResolvedValue({ ok: true }),
      fetchPage: shared as never,
    } as never);
    expect(r[0].status).toBe("info");
    expect(shared).toHaveBeenCalledTimes(1);
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });
});
