import { describe, it, expect, vi } from "vitest";
import { queryOsvBatch, OSV_API_BASE, type OsvFetch } from "../osv";

function makeFetch(body: unknown, ok = true) {
  const fn = vi.fn<OsvFetch>(async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
  return fn as unknown as OsvFetch & { mock: typeof fn.mock };
}

describe("queryOsvBatch (plan 71)", () => {
  it("retourneert leeg bij geen queries (geen call)", async () => {
    const fetchImpl = makeFetch({});
    expect(await queryOsvBatch([], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normaliseert de querybatch-response per query in volgorde", async () => {
    const body = {
      results: [
        {
          vulns: [
            {
              id: "GHSA-1",
              summary: "rce",
              database_specific: { severity: "CRITICAL" },
            },
          ],
        },
        {}, // geen vulns voor de tweede query
      ],
    };
    const fetchImpl = makeFetch(body);
    const [a, b] = await queryOsvBatch(
      [
        { package: { name: "jquery", ecosystem: "npm" }, version: "3.4.1" },
        { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20" },
      ],
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${OSV_API_BASE}/querybatch`);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "GHSA-1", severity: "critical", package_name: "jquery", version: "3.4.1" });
    expect(b).toEqual([]);
  });

  it("POST met JSON-body en content-type header", async () => {
    const fetchImpl = makeFetch({ results: [{}, {}] });
    await queryOsvBatch(
      [
        { package: { name: "a", ecosystem: "npm" }, version: "1.0.0" },
        { package: { name: "b", ecosystem: "npm" }, version: "2.0.0" },
      ],
      { fetchImpl },
    );
    const init = fetchImpl.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(init.body);
    expect(parsed.queries).toHaveLength(2);
    expect(parsed.queries[0]).toEqual({ package: { name: "a", ecosystem: "npm" }, version: "1.0.0" });
  });

  it("leeg per query bij non-ok response", async () => {
    const fetchImpl = makeFetch({}, false);
    const out = await queryOsvBatch(
      [{ package: { name: "x", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    expect(out).toEqual([[]]);
  });

  it("leeg per query bij ongeldig JSON-antwoord", async () => {
    const fetchImpl = makeFetch("not-json");
    const out = await queryOsvBatch(
      [{ package: { name: "x", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    expect(out).toEqual([[]]);
  });

  it("leeg per query bij netwerkfout", async () => {
    const fetchImpl = (vi.fn(async () => {
      throw new Error("network");
    }) as unknown) as OsvFetch;
    const out = await queryOsvBatch(
      [{ package: { name: "x", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    expect(out).toEqual([[]]);
  });

  it("CVSS-score wordt via gedeelde normalize naar severity gemapt", async () => {
    const body = {
      results: [
        {
          vulns: [
            {
              id: "CVE-cvss",
              summary: "issue",
              severity: [{ type: "CVSS_V3", score: 8.1 }],
            },
          ],
        },
      ],
    };
    const fetchImpl = makeFetch(body);
    const [[v]] = await queryOsvBatch(
      [{ package: { name: "lib", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    expect(v.severity).toBe("high");
  });
});
