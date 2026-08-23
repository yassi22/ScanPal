import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClientDepsCveCheck } from "../client-deps-cve";
import { fetchPage } from "../../types";
import type { OsvVulnerability } from "@scanpal/shared";

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

function htmlResponse(html: string): Response {
  const h = new Headers({ "content-type": "text/html" });
  return { headers: h, text: () => Promise.resolve(html) } as unknown as Response;
}

function nonHtmlResponse(): Response {
  const h = new Headers({ "content-type": "application/json" });
  return { headers: h, text: () => Promise.resolve("{}") } as unknown as Response;
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
  mockedFetchPage.mockReset();
});

describe("createClientDepsCveCheck (plan 71)", () => {
  it("info bij non-HTML response", async () => {
    mockedFetchPage.mockResolvedValue(nonHtmlResponse());
    const check = createClientDepsCveCheck();
    const [result] = await check.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("Geen HTML-pagina");
  });

  it("pass wanneer geen client-side libs herkend worden", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse('<script src="/assets/app.js"></script>'),
    );
    const check = createClientDepsCveCheck({
      queryOsv: vi.fn(),
    });
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Geen client-side JS-libraries herkend");
  });

  it("fail bij critical CVE-match op URL-only site (geen repo)", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(
        '<script src="https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js"></script>',
      ),
    );
    const queryOsv = vi.fn().mockResolvedValue([vulns]);
    const check = createClientDepsCveCheck({ queryOsv });
    const [result] = await check.run(ctx());
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "client-deps",
      total: 1,
      vulnerable: 1,
      by_severity: expect.objectContaining({ critical: 1 }),
    });
    expect(result.detail).toContain("1 van 1");
    // OSV werd batched bevraagd met de juiste (package, version)
    expect(queryOsv).toHaveBeenCalledTimes(1);
    const queriesArg = queryOsv.mock.calls[0][0];
    expect(queriesArg).toEqual([
      { package: { name: "jquery", ecosystem: "npm" }, version: "3.4.1" },
    ]);
  });

  it("pass wanneer deps herkend maar zonder bekende vulns", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(
        '<script src="https://unpkg.com/react@17.0.2/umd/react.production.min.js"></script>',
      ),
    );
    const queryOsv = vi.fn().mockResolvedValue([[]]);
    const check = createClientDepsCveCheck({ queryOsv });
    const [result] = await check.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("geen bekende kwetsbaarheden");
    expect(result.evidence).toBeNull();
  });

  it("warn bij rate-limit op OSV", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(
        '<script src="https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js"></script>',
      ),
    );
    const queryOsv = vi.fn();
    const check = createClientDepsCveCheck({ queryOsv });
    const [result] = await check.run({
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(queryOsv).not.toHaveBeenCalled();
  });

  it("geen dubbele finding met repo-osv-scanner (apart check-id)", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(
        '<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.20/lodash.min.js"></script>',
      ),
    );
    const check = createClientDepsCveCheck({
      queryOsv: vi.fn().mockResolvedValue([[]]),
    });
    const [result] = await check.run(ctx());
    expect(result.id).toBe("client-deps-cve");
    expect(result.id).not.toBe("osv-scanner");
  });
});
