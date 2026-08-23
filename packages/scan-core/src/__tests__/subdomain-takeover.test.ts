import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enumerateSubdomains,
  probeCnameTakeover,
  fetchCtSubdomains,
} from "../domain-net";

// Mock-fetch voor crt.sh-lookups.
function mockFetchOk(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => json,
  } as unknown as typeof fetch);
}

function mockFetchFail() {
  return vi.fn().mockResolvedValue({ ok: false } as unknown as typeof fetch);
}

// Mock-resolver: een object met resolveCname/resolve4 die op basis van de host
// een voorgeprogrammeerde waarde retourneren.
type ResolverState = {
  cnames?: Record<string, string[]>;
  a?: Record<string, string[]>;
  throwCname?: Set<string>;
  throwA?: Set<string>;
};

function mockResolver(state: ResolverState) {
  return {
    resolveCname: vi.fn(async (host: string) => {
      if (state.throwCname?.has(host)) throw new Error("ENOTFOUND");
      const v = state.cnames?.[host];
      if (!v) throw new Error("ENODATA");
      return v;
    }),
    resolve4: vi.fn(async (host: string) => {
      if (state.throwA?.has(host)) throw new Error("ENOTFOUND");
      const v = state.a?.[host];
      if (!v) throw new Error("ENODATA");
      return v;
    }),
  } as unknown as typeof import("node:dns/promises");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCtSubdomains", () => {
  it("parsed crt.sh JSON en filtert op apex", async () => {
    const json = [
      { name_value: "staging.example.com\nwww.example.com" },
      { name_value: "blog.other.com" },
    ];
    const r = await fetchCtSubdomains("example.com", {
      fetchImpl: mockFetchOk(json) as unknown as typeof fetch,
    });
    expect(r).toEqual(["staging.example.com", "www.example.com"]);
  });

  it("retourneert null bij non-ok response", async () => {
    const r = await fetchCtSubdomains("example.com", {
      fetchImpl: mockFetchFail() as unknown as typeof fetch,
    });
    expect(r).toBeNull();
  });

  it("retourneert null bij een fetch-fout (timeout/netwerk)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("abort")) as unknown as typeof fetch;
    const r = await fetchCtSubdomains("example.com", { fetchImpl });
    expect(r).toBeNull();
  });
});

describe("enumerateSubdomains", () => {
  it("combineert sitemap + crt.sh, dedup, en sluit www/apex uit als kandidaat", async () => {
    const json = [{ name_value: "staging.example.com\napi.example.com" }];
    const r = await enumerateSubdomains(
      "example.com",
      ["www.example.com", "staging.example.com", "example.com"],
      { fetchImpl: mockFetchOk(json) as unknown as typeof fetch },
    );
    expect(r.candidates).toEqual(["api.example.com", "staging.example.com"]);
    expect(r.sources).toContain("sitemap");
    expect(r.sources).toContain("crtsh");
    expect(r.ct_failed).toBe(false);
  });

  it("valt terug op sitemap-only als crt.sh faalt", async () => {
    const r = await enumerateSubdomains(
      "example.com",
      ["blog.example.com"],
      { fetchImpl: mockFetchFail() as unknown as typeof fetch },
    );
    expect(r.candidates).toEqual(["blog.example.com"]);
    expect(r.sources).toEqual(["sitemap"]);
    expect(r.ct_failed).toBe(true);
  });

  it("levert geen kandidaten als beide bronnen leeg zijn", async () => {
    const r = await enumerateSubdomains("example.com", [], {
      fetchImpl: mockFetchOk([]) as unknown as typeof fetch,
    });
    expect(r.candidates).toEqual([]);
    expect(r.sources).toEqual([]);
    expect(r.ct_failed).toBe(false);
  });

  it("negeert subdomeinen van andere apexen uit de sitemap", async () => {
    const r = await enumerateSubdomains(
      "example.com",
      ["blog.other.com", "staging.example.com"],
      { fetchImpl: mockFetchOk([]) as unknown as typeof fetch },
    );
    expect(r.candidates).toEqual(["staging.example.com"]);
  });
});

describe("probeCnameTakeover", () => {
  it("high: dangling CNAME naar herokuapp.com (target NXDOMAIN)", async () => {
    const resolver = mockResolver({
      cnames: { "staging.example.com": ["example.herokuapp.com"] },
      a: { "staging.example.com": [] },
      throwA: new Set(["example.herokuapp.com"]),
    });
    const probe = await probeCnameTakeover("staging.example.com", {
      dnsResolver: resolver,
    });
    expect(probe.cname_target).toBe("example.herokuapp.com");
    expect(probe.target_resolves).toBe(false);
  });

  it("info: resolvend target (niet dangling)", async () => {
    const resolver = mockResolver({
      cnames: { "staging.example.com": ["example.herokuapp.com"] },
      a: { "staging.example.com": [], "example.herokuapp.com": ["1.2.3.4"] },
    });
    const probe = await probeCnameTakeover("staging.example.com", {
      dnsResolver: resolver,
    });
    expect(probe.cname_target).toBe("example.herokuapp.com");
    expect(probe.target_resolves).toBe(true);
  });

  it("info: geen CNAME-record", async () => {
    const resolver = mockResolver({
      throwCname: new Set(["plain.example.com"]),
      a: { "plain.example.com": ["1.2.3.4"] },
    });
    const probe = await probeCnameTakeover("plain.example.com", {
      dnsResolver: resolver,
    });
    expect(probe.cname_target).toBeNull();
    expect(probe.resolves).toBe(true);
  });

  it("failure-resistent: alles falend → cname_target null, resolves false", async () => {
    const resolver = mockResolver({
      throwCname: new Set(["broken.example.com"]),
      throwA: new Set(["broken.example.com"]),
    });
    const probe = await probeCnameTakeover("broken.example.com", {
      dnsResolver: resolver,
    });
    expect(probe.cname_target).toBeNull();
    expect(probe.resolves).toBe(false);
    expect(probe.target_resolves).toBe(false);
  });
});
