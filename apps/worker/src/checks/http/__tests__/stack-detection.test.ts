import { describe, it, expect, vi, beforeEach } from "vitest";
import { stackDetectionCheck } from "../stack-detection";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function ctx() {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function response(headers: Record<string, string>, body: string): Response {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return {
    headers: h,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("stackDetectionCheck", () => {
  it("herkent WordPress + nginx en geeft pass", async () => {
    mockedFetchPage.mockResolvedValue(
      response(
        { server: "nginx/1.25", "content-type": "text/html" },
        `<html><head><meta name="generator" content="WordPress 6.4"></head>
         <body><script src="/wp-content/themes/x/main.js"></script></body></html>`,
      ),
    );
    const [result] = await stackDetectionCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("WordPress");
    expect(result.detail).toContain("nginx");
    expect(result.evidence).toMatchObject({ kind: "stack-detection" });
  });

  it("info bij onbekende stack", async () => {
    mockedFetchPage.mockResolvedValue(
      response({ "content-type": "text/html" }, "<html><body>niets herkenbaars</body></html>"),
    );
    const [result] = await stackDetectionCheck.run(ctx());
    expect(result.status).toBe("info");
  });

  it("warn bij fetch-fout", async () => {
    mockedFetchPage.mockRejectedValue(new Error("timeout"));
    const [result] = await stackDetectionCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("timeout");
  });
});
