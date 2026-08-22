import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateEmailDns, dnsEmailCheck } from "../dns-email";

vi.mock("@scanpal/scan-core", () => ({
  resolveEmailDns: vi.fn(),
  toPunycode: vi.fn((h: string) => h.toLowerCase()),
}));

vi.mock("@scanpal/shared", async () => {
  const actual = await vi.importActual("@scanpal/shared");
  return { ...actual, registrableDomain: vi.fn((h: string) => h) };
});

import { resolveEmailDns } from "@scanpal/scan-core";
import type { EmailDns } from "@scanpal/shared";

const mockedResolve = vi.mocked(resolveEmailDns);

beforeEach(() => {
  mockedResolve.mockReset();
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

function emailDns(over: Partial<EmailDns> = {}): EmailDns {
  return {
    spf: { present: true, raw: "v=spf1 -all", all_qualifier: "-all" },
    spf_record_count: 1,
    dmarc: { present: true, policy: "reject", rua_present: true },
    mx: ["mail.example.com"],
    dkim_selectors_found: ["google"],
    ...over,
  };
}

describe("evaluateEmailDns", () => {
  it("info bij alles in orde", () => {
    const r = evaluateEmailDns(emailDns(), "DNS & e-mail");
    expect(r.status).toBe("info");
    expect(r.detail).toContain("in orde");
  });

  it("fail bij ontbrekende DMARC op verzendend domein", () => {
    const r = evaluateEmailDns(emailDns({ dmarc: null }), "DNS & e-mail");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("DMARC");
  });

  it("fail bij DMARC p=none", () => {
    const r = evaluateEmailDns(
      emailDns({ dmarc: { present: true, policy: "none", rua_present: false } }),
      "DNS & e-mail",
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("p=none");
  });

  it("warn bij DMARC quarantine zonder rua", () => {
    const r = evaluateEmailDns(
      emailDns({ dmarc: { present: true, policy: "quarantine", rua_present: false } }),
      "DNS & e-mail",
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("rua");
  });

  it("warn bij ontbrekende SPF", () => {
    const r = evaluateEmailDns(emailDns({ spf: null }), "DNS & e-mail");
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("SPF");
  });

  it("warn bij permissieve SPF (+all)", () => {
    const r = evaluateEmailDns(
      emailDns({ spf: { present: true, raw: "v=spf1 +all", all_qualifier: "+all" } }),
      "DNS & e-mail",
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("+all");
  });

  it("info (geen straf) bij domein zonder MX", () => {
    const r = evaluateEmailDns(emailDns({ mx: [] }), "DNS & e-mail");
    expect(r.status).toBe("info");
    expect(r.detail).toContain("geen e-mail");
  });

  it("evidence is JSON-string met de meting", () => {
    const r = evaluateEmailDns(emailDns(), "DNS & e-mail");
    expect(typeof r.evidence).toBe("string");
    const parsed = JSON.parse(r.evidence as string);
    expect(parsed.mx).toEqual(["mail.example.com"]);
  });

  it("vermeldt geen-DKIM-selector als low-signaal in ok-detail", () => {
    const r = evaluateEmailDns(emailDns({ dkim_selectors_found: [] }), "DNS & e-mail");
    expect(r.status).toBe("info");
    expect(r.detail).toContain("geen DKIM-selector");
  });

  it("vermeldt meerdere SPF-records als low-signaal (RFC-overtreding)", () => {
    const r = evaluateEmailDns(emailDns({ spf_record_count: 2 }), "DNS & e-mail");
    expect(r.detail).toContain("meerdere SPF-records");
  });
});

describe("dnsEmailCheck.run", () => {
  it("rate-limit → info", async () => {
    const rate = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const results = await dnsEmailCheck.run(ctx("https://example.com", rate));
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("rate-limit");
    expect(rate).toHaveBeenCalledWith("dns-email:example.com", 5, 60);
  });

  it("meet via resolveEmailDns en produceert info bij OK", async () => {
    mockedResolve.mockResolvedValue(emailDns());
    const results = await dnsEmailCheck.run(ctx("https://example.com"));
    expect(mockedResolve).toHaveBeenCalledWith("example.com", expect.anything());
    expect(results[0].status).toBe("info");
    expect(results[0].id).toBe("dns-email");
  });

  it("produceert fail bij ontbrekende DMARC", async () => {
    mockedResolve.mockResolvedValue(emailDns({ dmarc: null }));
    const results = await dnsEmailCheck.run(ctx("https://example.com"));
    expect(results[0].status).toBe("fail");
  });

  it("geeft info-finding bij een resolveEmailDns-fout (geen storing)", async () => {
    mockedResolve.mockRejectedValue(new Error("dns timeout"));
    const results = await dnsEmailCheck.run(ctx("https://example.com"));
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("niet controleerbaar");
  });

  it("info bij ongeldige hostnaam", async () => {
    const results = await dnsEmailCheck.run(ctx("https://localhost"));
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("geen geldige hostnaam");
  });
});
