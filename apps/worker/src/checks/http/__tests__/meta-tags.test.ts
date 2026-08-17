import { describe, it, expect, vi, beforeEach } from "vitest";
import { metaTagsCheck } from "../meta-tags";
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

function htmlResponse(body: string, contentType = "text/html; charset=utf-8") {
  return {
    headers: { get: (name: string) => (name === "content-type" ? contentType : null) },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("metaTagsCheck", () => {
  it("pass bij complete pagina met title+description+canonical", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(`<html><head>
        <title>Pagina</title>
        <meta name="description" content="Beschrijving">
        <link rel="canonical" href="https://example.com/x">
      </head></html>`),
    );
    const [result] = await metaTagsCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "meta-tags" });
  });

  it("fail als title ontbreekt", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(`<html><head><meta name="description" content="x"></head></html>`),
    );
    const [result] = await metaTagsCheck.run(ctx());
    expect(result.status).toBe("fail");
  });

  it("warn bij non-html content-type", async () => {
    mockedFetchPage.mockResolvedValue(htmlResponse("{}", "application/json"));
    const [result] = await metaTagsCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Geen HTML-pagina");
  });

  it("fail bij fetch-fout", async () => {
    mockedFetchPage.mockRejectedValue(new Error("network down"));
    const [result] = await metaTagsCheck.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("network down");
  });
});
