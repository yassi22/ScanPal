import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createActiveTestsCheck } from "../active-tests";

vi.mock("../../types", async () => {
  const actual = await vi.importActual("../../types");
  return { ...actual, fetchPage: vi.fn() };
});

import { fetchPage } from "../../types";
const mockedFetchPage = vi.mocked(fetchPage);

const URL = "https://example.com";

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response("", { status, headers });
}

function ctx(rateLimit: () => Promise<unknown>) {
  return {
    url: URL,
    scanId: "scan-1",
    activeTests: true,
    rateLimit: rateLimit as never,
  } as never;
}

let fetchSpy: MockInstance;

beforeEach(() => {
  mockedFetchPage.mockReset();
  // Initiële pagina-fetch in active-tests gebruikt de globale `fetch`.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    mockResponse(200, { "content-type": "text/html" }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function okRate() {
  return vi.fn().mockResolvedValue({ ok: true });
}

/**
 * fetchPage-mock die de burst (url === scan-URL) isoleert van de andere probes
 * (debug-endpoints, graphql), die een 404 krijgen. Zo is de burst-uitkomst
 * deterministisch zonder de andere 11 tests te hoeven sturen.
 */
function burstFetchPage(burstResponses: Response[]) {
  let i = 0;
  mockedFetchPage.mockImplementation((url: string) => {
    if (url === URL) {
      return Promise.resolve(burstResponses[i++] ?? burstResponses[burstResponses.length - 1]);
    }
    return Promise.resolve(mockResponse(404));
  });
}

describe("rate-limit-burst (active-tests #12, plan 73)", () => {
  it("pass bij 429 in de burst", async () => {
    burstFetchPage([
      mockResponse(200),
      mockResponse(200),
      mockResponse(429, { "retry-after": "30" }),
      mockResponse(429),
      mockResponse(429),
      mockResponse(429),
    ]);
    const check = createActiveTestsCheck(okRate());
    const results = await check.run(ctx(okRate()));
    const burst = results.find((r) => r.id === "rate-limit-burst");
    expect(burst).toBeDefined();
    expect(burst!.status).toBe("pass");
    expect(burst!.detail).toContain("429");
  });

  it("pass bij retry-after in de burst", async () => {
    burstFetchPage([
      mockResponse(200),
      mockResponse(200, { "retry-after": "10" }),
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
    ]);
    const check = createActiveTestsCheck(okRate());
    const results = await check.run(ctx(okRate()));
    const burst = results.find((r) => r.id === "rate-limit-burst");
    expect(burst!.status).toBe("pass");
    expect(burst!.detail).toContain("retry-after");
  });

  it("pass bij remaining=0 in de burst", async () => {
    burstFetchPage([
      mockResponse(200, { "x-ratelimit-remaining": "5" }),
      mockResponse(200, { "x-ratelimit-remaining": "3" }),
      mockResponse(200, { "x-ratelimit-remaining": "0" }),
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
    ]);
    const check = createActiveTestsCheck(okRate());
    const results = await check.run(ctx(okRate()));
    const burst = results.find((r) => r.id === "rate-limit-burst");
    expect(burst!.status).toBe("pass");
    expect(burst!.detail).toContain("remaining=0");
  });

  it("warn bij geen rate-limiting onder de burst", async () => {
    burstFetchPage([
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
      mockResponse(200),
    ]);
    const check = createActiveTestsCheck(okRate());
    const results = await check.run(ctx(okRate()));
    const burst = results.find((r) => r.id === "rate-limit-burst");
    expect(burst!.status).toBe("warn");
    expect(burst!.detail).toContain("Geen rate-limiting");
  });

  it("info bij onvolledige burst (eigen rate-limiter uitgeput)", async () => {
    // rateLimit weigert alles → alle probeGet/burst-requesten retourneren null.
    const blocked = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    burstFetchPage([mockResponse(200), mockResponse(200), mockResponse(200)]);
    const check = createActiveTestsCheck(blocked);
    const results = await check.run(ctx(blocked));
    const burst = results.find((r) => r.id === "rate-limit-burst");
    expect(burst!.status).toBe("info");
    expect(burst!.detail).toContain("onvolledig");
  });

  it("is active: true (telt niet mee in de score)", async () => {
    burstFetchPage([mockResponse(200), mockResponse(200), mockResponse(200), mockResponse(200), mockResponse(200), mockResponse(200)]);
    const check = createActiveTestsCheck(okRate());
    const results = await check.run(ctx(okRate()));
    const burst = results.find((r) => r.id === "rate-limit-burst");
    expect(burst).toMatchObject({ active: true, id: "rate-limit-burst" });
  });
});
