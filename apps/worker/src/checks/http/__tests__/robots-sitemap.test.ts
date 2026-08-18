import { describe, it, expect, vi, beforeEach } from "vitest";
import { robotsSitemapCheck } from "../robots-sitemap";
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

function textResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const ROBOTS = `User-agent: *
Disallow: /admin/
Sitemap: https://example.com/sitemap.xml
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("robotsSitemapCheck (feature 36)", () => {
  it("pass: robots.txt + sitemap via Sitemap:-directive", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.resolve(textResponse(ROBOTS));
      if (url.endsWith("/sitemap.xml")) return Promise.resolve(textResponse(SITEMAP));
      return Promise.reject(new Error("unexpected fetch"));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "robots-sitemap" });
    expect(result.evidence).toMatchObject({
      robots_txt: { present: true, has_wildcard_agent: true },
      sitemap: { present: true, url_count: 2, discovered_from_robots: true },
    });
    // Sitemap-URL kwam uit de directive — niet /sitemap.xml als fallback dubbel.
    expect(mockedFetchPage).toHaveBeenCalledWith(
      "https://example.com/sitemap.xml",
      expect.anything(),
    );
  });

  it("pass: sitemap zonder directive valt terug op /sitemap.xml", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) {
        return Promise.resolve(textResponse("User-agent: *\nDisallow:\n"));
      }
      return Promise.resolve(textResponse(SITEMAP));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({
      sitemap: { discovered_from_robots: false, url_count: 2 },
    });
  });

  it("fail: robots.txt ontbreekt (404)", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.resolve(textResponse("", 404));
      return Promise.resolve(textResponse(SITEMAP));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("robots.txt ontbreekt");
    expect(result.evidence).toMatchObject({ robots_txt: { present: false } });
  });

  it("fail: robots.txt onbereikbaar (netwerkfout)", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.reject(new Error("refused"));
      return Promise.resolve(textResponse(SITEMAP));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("fail");
  });

  it("warn: robots.txt zonder sitemap-directive en /sitemap.xml 404", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) {
        return Promise.resolve(textResponse("User-agent: *\nDisallow:\n"));
      }
      return Promise.resolve(textResponse("", 404));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("geen sitemap.xml gevonden");
    expect(result.evidence).toMatchObject({ sitemap: { present: false } });
  });

  it("fail: sitemap via directive is onbereikbaar", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.resolve(textResponse(ROBOTS));
      return Promise.reject(new Error("refused"));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("sitemap gedeclareerd in robots.txt maar onbereikbaar");
  });

  it("fail: non-XML sitemap-body", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/robots.txt")) return Promise.resolve(textResponse(ROBOTS));
      return Promise.resolve(textResponse("<html>nope</html>"));
    });

    const [result] = await robotsSitemapCheck.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("sitemap is geen geldig XML-document");
  });

  it("warn: rate-limit bereikt slaat de check over", async () => {
    const rateLimitedCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };

    const [result] = await robotsSitemapCheck.run(rateLimitedCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(result.evidence).toBeUndefined();
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });
});
