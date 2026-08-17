import { describe, it, expect, vi, beforeEach } from "vitest";
import { miniCrawlCheck } from "../mini-crawl";
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

function htmlResponse(body: string, contentType = "text/html; charset=utf-8") {
  return {
    headers: { get: (name: string) => (name === "content-type" ? contentType : null) },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function sitemapResponse(urls: string[]) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
  return {
    headers: { get: () => "application/xml" },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("miniCrawlCheck (feature 38)", () => {
  it("pass: alle images hebben alt, alle sitemap-routes gelinkt", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return Promise.resolve(
          sitemapResponse(["https://example.com/a", "https://example.com/b"]),
        );
      }
      return Promise.resolve(
        htmlResponse(
          `<img src="/a.png" alt="A"><img src="/b.png" alt="B">
           <a href="/a">A</a><a href="/b">B</a>`,
        ),
      );
    });

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "mini-crawl" });
    expect(result.evidence).toMatchObject({
      image_audit: { total: 2, missing: 0 },
      orphan_pages: { sitemap_count: 2, orphan_count: 0 },
    });
  });

  it("warn: images zonder alt-attribuut", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return Promise.resolve(sitemapResponse(["https://example.com/"]));
      }
      return Promise.resolve(
        htmlResponse(
          `<img src="/a.png" alt="A"><img src="/missing.png">
           <a href="/">home</a>`,
        ),
      );
    });

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("1 van 2 image(s) zonder alt-attribuut");
    expect(result.evidence).toMatchObject({
      image_audit: { total: 2, missing: 1, samples: ["/missing.png"] },
    });
  });

  it("warn: sitemap-orphan-pagina's", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return Promise.resolve(
          sitemapResponse([
            "https://example.com/a",
            "https://example.com/orphan",
          ]),
        );
      }
      return Promise.resolve(
        htmlResponse(`<img src="/a.png" alt="A"><a href="/a">A</a>`),
      );
    });

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("1 van 2 sitemap-route(s) niet gelinkt");
    expect(result.evidence).toMatchObject({
      orphan_pages: { sitemap_count: 2, orphan_count: 1 },
    });
  });

  it("pass zonder sitemap (fetch faalt): alleen image-audit", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return Promise.reject(new Error("404"));
      }
      return Promise.resolve(
        htmlResponse(`<img src="/a.png" alt="A"><a href="/">home</a>`),
      );
    });

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({
      image_audit: { total: 1, missing: 0 },
    });
    // Geen sitemap → detail vermeldt images maar geen orphan-regel.
    expect(result.detail).not.toContain("sitemap-route");
  });

  it("fail: homepage niet ophaalbaar", async () => {
    mockedFetchPage.mockRejectedValue(new Error("connection refused"));

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Homepage niet op te halen");
    expect(result.evidence).toBeUndefined();
  });

  it("warn: non-html content-type op homepage", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return Promise.resolve(sitemapResponse(["https://example.com/"]));
      }
      return Promise.resolve(htmlResponse(`{}`, "application/json"));
    });

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Geen HTML-pagina");
  });

  it("warn: rate-limit bereikt slaat de check over", async () => {
    const rateLimitedCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };

    const [result] = await miniCrawlCheck.run(rateLimitedCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(result.evidence).toBeUndefined();
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });

  it("pass zonder images en zonder sitemap: evidence null", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return Promise.resolve(htmlResponse("", "text/plain"));
      }
      return Promise.resolve(htmlResponse(`<html><body>tekst<a href="/">x</a></body></html>`));
    });

    const [result] = await miniCrawlCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Geen images of sitemap-routes");
    expect(result.evidence).toBeNull();
  });
});
