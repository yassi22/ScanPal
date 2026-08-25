import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateSubdomainTakeover,
  subdomainTakeoverCheck,
} from "../subdomain-takeover";

vi.mock("@scanpal/scan-core", () => ({
  enumerateSubdomains: vi.fn(),
  probeCnameTakeover: vi.fn(),
  toPunycode: vi.fn((h: string) => h.toLowerCase()),
}));

vi.mock("@scanpal/shared", async () => {
  const actual = await vi.importActual("@scanpal/shared");
  return { ...actual, registrableDomain: vi.fn((h: string) => h) };
});

import { enumerateSubdomains, probeCnameTakeover } from "@scanpal/scan-core";
import type { SubdomainTakeover } from "@scanpal/shared";

const mockedEnumerate = vi.mocked(enumerateSubdomains);
const mockedProbe = vi.mocked(probeCnameTakeover);

beforeEach(() => {
  mockedEnumerate.mockReset();
  mockedProbe.mockReset();
});

function okRateLimit() {
  return vi.fn().mockResolvedValue({ ok: true });
}

function ctx(url = "https://example.com", rateLimit = okRateLimit()) {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: rateLimit as never,
  };
}

function takeover(over: Partial<SubdomainTakeover> = {}): SubdomainTakeover {
  return {
    subdomains_found: ["staging.example.com"],
    vulnerable: [],
    sources: ["crtsh"],
    ct_failed: false,
    ...over,
  };
}

describe("evaluateSubdomainTakeover", () => {
  it("fail bij high-severity dangling CNAME naar bekende service", () => {
    const r = evaluateSubdomainTakeover(
      takeover({
        vulnerable: [
          {
            subdomain: "staging.example.com",
            cname_target: "example.herokuapp.com",
            service: "herokuapp.com",
            severity: "high",
          },
        ],
      }),
      "Subdomain-takeover",
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("herokuapp.com");
    expect(r.detail).toContain("staging.example.com");
  });

  it("warn bij medium-severity dangling CNAME naar onbekend target", () => {
    const r = evaluateSubdomainTakeover(
      takeover({
        vulnerable: [
          {
            subdomain: "old.example.com",
            cname_target: "ghost.someinternal.corp",
            service: null,
            severity: "medium",
          },
        ],
      }),
      "Subdomain-takeover",
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("onbekend target");
  });

  it("info bij resolvende subdomeinen (geen vatbare)", () => {
    const r = evaluateSubdomainTakeover(
      takeover({ subdomains_found: ["staging.example.com", "api.example.com"] }),
      "Subdomain-takeover",
    );
    expect(r.status).toBe("info");
    expect(r.detail).toContain("2 subdomeinen");
    expect(r.detail).toContain("resolvend");
  });

  it("info bij geen subdomeinen gevonden", () => {
    const r = evaluateSubdomainTakeover(
      takeover({ subdomains_found: [], sources: [] }),
      "Subdomain-takeover",
    );
    expect(r.status).toBe("info");
    expect(r.detail).toContain("geen subdomeinen");
  });

  it("info vermeldt ct.sh-faal (enumeratie onvolledig)", () => {
    const r = evaluateSubdomainTakeover(
      takeover({ subdomains_found: [], sources: [], ct_failed: true }),
      "Subdomain-takeover",
    );
    expect(r.status).toBe("info");
    expect(r.detail).toContain("crt.sh niet bereikbaar");
  });
});

describe("subdomainTakeoverCheck (run)", () => {
  it("info bij ongeldige hostnaam", async () => {
    const r = await subdomainTakeoverCheck.run({
      ...ctx("https://localhost"),
    } as never);
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("geen geldige hostnaam");
  });

  it("fail bij dangling CNAME naar bekende service", async () => {
    mockedEnumerate.mockResolvedValue({
      candidates: ["staging.example.com"],
      sources: ["crtsh"],
      ct_failed: false,
    });
    mockedProbe.mockResolvedValue({
      subdomain: "staging.example.com",
      cname_target: "example.herokuapp.com",
      resolves: false,
      target_resolves: false,
    });
    const r = await subdomainTakeoverCheck.run(ctx() as never);
    expect(r[0].status).toBe("fail");
    expect(r[0].detail).toContain("herokuapp.com");
  });

  it("warn bij dangling CNAME naar onbekend target", async () => {
    mockedEnumerate.mockResolvedValue({
      candidates: ["old.example.com"],
      sources: ["crtsh"],
      ct_failed: false,
    });
    mockedProbe.mockResolvedValue({
      subdomain: "old.example.com",
      cname_target: "ghost.someinternal.corp",
      resolves: false,
      target_resolves: false,
    });
    const r = await subdomainTakeoverCheck.run(ctx() as never);
    expect(r[0].status).toBe("warn");
  });

  it("info bij resolvende subdomeinen", async () => {
    mockedEnumerate.mockResolvedValue({
      candidates: ["staging.example.com"],
      sources: ["crtsh"],
      ct_failed: false,
    });
    mockedProbe.mockResolvedValue({
      subdomain: "staging.example.com",
      cname_target: "example.herokuapp.com",
      resolves: true,
      target_resolves: true,
    });
    const r = await subdomainTakeoverCheck.run(ctx() as never);
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("resolvend");
  });

  it("info bij geen subdomeinen + ct.sh-faal", async () => {
    mockedEnumerate.mockResolvedValue({
      candidates: [],
      sources: [],
      ct_failed: true,
    });
    const r = await subdomainTakeoverCheck.run(ctx() as never);
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("crt.sh niet bereikbaar");
  });

  it("info bij enumeratie-fout (exception)", async () => {
    mockedEnumerate.mockRejectedValue(new Error("dns down"));
    const r = await subdomainTakeoverCheck.run(ctx() as never);
    expect(r[0].status).toBe("info");
    expect(r[0].detail).toContain("niet uitvoerbaar");
  });
});
