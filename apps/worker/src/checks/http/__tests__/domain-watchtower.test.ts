import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateDomainMeasurement, domainWatchtowerCheck } from "../domain-watchtower";

vi.mock("@scanpal/scan-core", () => ({
  measureDomain: vi.fn(),
}));

import { measureDomain } from "@scanpal/scan-core";
import type { DomainMeasurement } from "@scanpal/shared";

const mockedMeasure = vi.mocked(measureDomain);

beforeEach(() => {
  mockedMeasure.mockReset();
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

const NOW = new Date("2026-08-17T00:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function measurement(over: Partial<DomainMeasurement> = {}): DomainMeasurement {
  return {
    domain_expiry: inDays(120),
    domain_registrar: "Example Registrar",
    dnssec_enabled: true,
    caa_present: false,
    tls_expiry: inDays(90),
    nameservers: ["ns1.example.com", "ns2.example.com"],
    caa_records: [],
    ...over,
  };
}

describe("evaluateDomainMeasurement", () => {
  it("fail bij verlopen domein", () => {
    const r = evaluateDomainMeasurement(measurement({ domain_expiry: inDays(-5) }), "Domain watchtower", NOW);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("verlopen");
  });

  it("warn bij expiry < 30 d", () => {
    const r = evaluateDomainMeasurement(measurement({ domain_expiry: inDays(10) }), "Domain watchtower", NOW);
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("verloopt over 10 d");
  });

  it("warn bij tls-runway < 14 d", () => {
    const r = evaluateDomainMeasurement(measurement({ tls_expiry: inDays(5) }), "Domain watchtower", NOW);
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("TLS-certificaat verloopt over 5 d");
  });

  it("warn bij DNSSEC uitgeschakeld", () => {
    const r = evaluateDomainMeasurement(measurement({ dnssec_enabled: false }), "Domain watchtower", NOW);
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("DNSSEC uitgeschakeld");
  });

  it("info met countdowns bij alles ok", () => {
    const r = evaluateDomainMeasurement(measurement(), "Domain watchtower", NOW);
    expect(r.status).toBe("info");
    expect(r.detail).toContain("expiry");
    expect(r.detail).toContain("tls");
    expect(r.detail).toContain("DNSSEC");
  });

  it("evidence is JSON-string met de volledige meting", () => {
    const r = evaluateDomainMeasurement(measurement(), "Domain watchtower", NOW);
    expect(typeof r.evidence).toBe("string");
    const parsed = JSON.parse(r.evidence as string);
    expect(parsed.domain_registrar).toBe("Example Registrar");
  });
});

describe("domainWatchtowerCheck.run", () => {
  it("rate-limit → info", async () => {
    const rate = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const results = await domainWatchtowerCheck.run(ctx("https://example.com", rate));
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("rate-limit");
    expect(rate).toHaveBeenCalledWith("domain-watchtower:example.com", 5, 60);
  });

  it("meet via measureDomain en produceert een info-finding bij OK", async () => {
    mockedMeasure.mockResolvedValue({ measurement: measurement(), rdap_ok: true });
    const results = await domainWatchtowerCheck.run(ctx("https://example.com"));
    expect(mockedMeasure).toHaveBeenCalledWith("example.com", expect.anything());
    expect(results[0].status).toBe("info");
    expect(results[0].id).toBe("domain-watchtower");
  });

  it("produceert warn bij afwijking", async () => {
    mockedMeasure.mockResolvedValue({
      measurement: measurement({ domain_expiry: inDays(10) }),
      rdap_ok: true,
    });
    const results = await domainWatchtowerCheck.run(ctx("https://example.com"));
    expect(results[0].status).toBe("warn");
  });

  it("geeft info-finding bij een measureDomain-fout (geen storing)", async () => {
    mockedMeasure.mockRejectedValue(new Error("rdap timeout"));
    const results = await domainWatchtowerCheck.run(ctx("https://example.com"));
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("niet controleerbaar");
  });
});
