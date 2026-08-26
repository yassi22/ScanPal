import { describe, it, expect, vi, beforeEach } from "vitest";
import { securityTxtCheck } from "../security-txt";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function ctx(rateLimitResult: { ok: true } | { ok: false; retryAfterSeconds: number } = { ok: true }) {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue(rateLimitResult) as never,
  };
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("securityTxtCheck", () => {
  it("geeft warn en fetcht niets wanneer rate-limit bereikt is", async () => {
    const [result] = await securityTxtCheck.run(ctx({ ok: false, retryAfterSeconds: 30 }));
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit bereikt");
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });
});
