import { describe, it, expect, vi } from "vitest";
import { queryOsvBatch, OSV_API_BASE, type OsvFetch } from "../osv";

/**
 * OSV `querybatch` retourneert per vuln BEWUST alléén `id` (+ `modified`).
 * Severity/summary komen pas uit `GET /vulns/{id}`. Deze mock modelleert die
 * twee-staps-realiteit: de POST levert ID-stubs, de GET's leveren detail.
 */
function makeOsvFetch(
  querybatch: { results: Array<{ vulns?: Array<{ id: string }> }> },
  detailsById: Record<string, unknown> = {},
  opts: { querybatchOk?: boolean; querybatchBody?: string } = {},
) {
  const fn = vi.fn<OsvFetch>(async (url) => {
    if (url.includes("/querybatch")) {
      const ok = opts.querybatchOk ?? true;
      return {
        ok,
        status: ok ? 200 : 500,
        text: async () =>
          opts.querybatchBody ?? JSON.stringify(querybatch),
      };
    }
    // GET /vulns/{id}
    const id = decodeURIComponent(url.split("/vulns/")[1] ?? "");
    const detail = detailsById[id];
    if (detail === undefined) {
      return { ok: false, status: 404, text: async () => "" };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(detail) };
  });
  return fn as unknown as OsvFetch & { mock: typeof fn.mock };
}

/** IDs waarvoor een GET /vulns/{id} werd gedaan. */
function detailCallIds(fetchImpl: OsvFetch & { mock: { calls: [string, unknown][] } }): string[] {
  return fetchImpl.mock.calls
    .map((c) => c[0])
    .filter((u) => u.includes("/vulns/"))
    .map((u) => decodeURIComponent(u.split("/vulns/")[1]));
}

describe("queryOsvBatch (plan 71)", () => {
  it("retourneert leeg bij geen queries (geen call)", async () => {
    const fetchImpl = makeOsvFetch({ results: [] });
    expect(await queryOsvBatch([], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hydrateert de ID-stubs en normaliseert per query in volgorde", async () => {
    const fetchImpl = makeOsvFetch(
      {
        results: [
          { vulns: [{ id: "GHSA-1" }] },
          {}, // geen vulns voor de tweede query
        ],
      },
      {
        "GHSA-1": {
          id: "GHSA-1",
          summary: "rce",
          database_specific: { severity: "CRITICAL" },
        },
      },
    );
    const [a, b] = await queryOsvBatch(
      [
        { package: { name: "jquery", ecosystem: "npm" }, version: "3.4.1" },
        { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20" },
      ],
      { fetchImpl },
    );
    // Eerste call is de batched POST; daarna een GET per uniek id.
    expect(fetchImpl.mock.calls[0][0]).toBe(`${OSV_API_BASE}/querybatch`);
    expect(detailCallIds(fetchImpl)).toEqual(["GHSA-1"]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      id: "GHSA-1",
      severity: "critical",
      summary: "rce",
      package_name: "jquery",
      version: "3.4.1",
    });
    expect(b).toEqual([]);
  });

  it("POST met JSON-body en content-type header", async () => {
    const fetchImpl = makeOsvFetch({ results: [{}, {}] });
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
    const parsed = JSON.parse(init.body as string);
    expect(parsed.queries).toHaveLength(2);
    expect(parsed.queries[0]).toEqual({ package: { name: "a", ecosystem: "npm" }, version: "1.0.0" });
  });

  it("dedupliceert detail-fetches over queries heen (één GET per uniek id)", async () => {
    const fetchImpl = makeOsvFetch(
      {
        results: [
          { vulns: [{ id: "GHSA-shared" }] },
          { vulns: [{ id: "GHSA-shared" }] },
        ],
      },
      {
        "GHSA-shared": {
          id: "GHSA-shared",
          severity: [{ type: "CVSS_V3", score: 9.8 }],
        },
      },
    );
    const [a, b] = await queryOsvBatch(
      [
        { package: { name: "x", ecosystem: "npm" }, version: "1.0.0" },
        { package: { name: "y", ecosystem: "npm" }, version: "2.0.0" },
      ],
      { fetchImpl },
    );
    // Slechts één detail-call, ondanks twee query-hits.
    expect(detailCallIds(fetchImpl)).toEqual(["GHSA-shared"]);
    expect(a[0]).toMatchObject({ severity: "critical", package_name: "x" });
    expect(b[0]).toMatchObject({ severity: "critical", package_name: "y" });
  });

  it("valt terug op een minimaal record als de detail-fetch faalt", async () => {
    // querybatch levert een id, maar er is geen detail (GET → 404).
    const fetchImpl = makeOsvFetch(
      { results: [{ vulns: [{ id: "GHSA-nodetail" }] }] },
      {}, // geen detail → 404
    );
    const [[v]] = await queryOsvBatch(
      [{ package: { name: "lib", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    // De finding vuurt nog steeds (id blijft), severity valt terug op de default.
    expect(v).toMatchObject({ id: "GHSA-nodetail", package_name: "lib", summary: "" });
    expect(v.severity).toBe("medium");
  });

  it("leeg per query bij non-ok querybatch-response (geen detail-calls)", async () => {
    const fetchImpl = makeOsvFetch({ results: [] }, {}, { querybatchOk: false });
    const out = await queryOsvBatch(
      [{ package: { name: "x", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    expect(out).toEqual([[]]);
    expect(detailCallIds(fetchImpl)).toEqual([]);
  });

  it("leeg per query bij ongeldig JSON-antwoord", async () => {
    const fetchImpl = makeOsvFetch({ results: [] }, {}, { querybatchBody: "not-json" });
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
    const fetchImpl = makeOsvFetch(
      { results: [{ vulns: [{ id: "CVE-cvss" }] }] },
      { "CVE-cvss": { id: "CVE-cvss", summary: "issue", severity: [{ type: "CVSS_V3", score: 8.1 }] } },
    );
    const [[v]] = await queryOsvBatch(
      [{ package: { name: "lib", ecosystem: "npm" }, version: "1.0.0" }],
      { fetchImpl },
    );
    expect(v.severity).toBe("high");
  });
});
