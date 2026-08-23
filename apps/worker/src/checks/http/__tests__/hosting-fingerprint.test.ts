import { describe, it, expect, vi, beforeEach } from "vitest";
import { hostingSecurityCheck } from "../hosting-fingerprint";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function response(headers: Record<string, string>): Response {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return { headers: h, text: () => Promise.resolve("") } as unknown as Response;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("hostingSecurityCheck", () => {
  it("herkent Vercel en geeft pass zonder signalen", async () => {
    mockedFetchPage.mockResolvedValue(
      response({ "x-vercel-id": "iad1::abc", server: "Vercel" }),
    );
    const [result] = await hostingSecurityCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Vercel");
    expect(result.evidence).toMatchObject({ kind: "hosting-fingerprint", platform: "vercel" });
  });

  it("origin-lek op Cloudflare → warn met low-severity", async () => {
    mockedFetchPage.mockResolvedValue(
      response({ "cf-ray": "abc", server: "nginx/1.25" }),
    );
    const [result] = await hostingSecurityCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.severity).toBe("low");
    expect(result.detail).toContain("origin");
    expect(result.evidence).toMatchObject({ platform: "cloudflare" });
  });

  it("cache-hygiëne: public + sessie-cookie → warn medium", async () => {
    mockedFetchPage.mockResolvedValue(
      response({
        "x-vercel-id": "iad1",
        "cache-control": "public, max-age=60",
        "set-cookie": "session=abc; HttpOnly",
      }),
    );
    const [result] = await hostingSecurityCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.severity).toBe("medium");
    expect(result.detail).toContain("cache-control");
  });

  it("preview-URL → warn", async () => {
    mockedFetchPage.mockResolvedValue(response({ "x-vercel-id": "iad1" }));
    const [result] = await hostingSecurityCheck.run(
      ctx("https://app-git-main-abc.vercel.app/"),
    );
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("preview");
  });

  it("onbekend platform → info, geen straf", async () => {
    mockedFetchPage.mockResolvedValue(response({ server: "nginx/1.25" }));
    const [result] = await hostingSecurityCheck.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("nginx");
  });

  it("warn bij fetch-fout", async () => {
    mockedFetchPage.mockRejectedValue(new Error("timeout"));
    const [result] = await hostingSecurityCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("timeout");
  });
});
