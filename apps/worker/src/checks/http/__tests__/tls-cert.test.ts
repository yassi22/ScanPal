import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateTlsCert, tlsCertCheck, type PeerCert } from "../tls-cert";

vi.mock("node:tls", () => ({
  default: { connect: vi.fn() },
}));

import tls from "node:tls";

const mockedConnect = vi.mocked(tls.connect);

beforeEach(() => {
  mockedConnect.mockReset();
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

function cert(overrides: Partial<PeerCert> = {}): PeerCert {
  const now = Date.now();
  const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();
  return {
    subject: { CN: "example.com" },
    issuer: { CN: "Let's Encrypt R3" },
    subjectaltname: "DNS:example.com, DNS:www.example.com",
    valid_from: inDays(-30),
    valid_to: inDays(90),
    ...overrides,
  };
}

describe("evaluateTlsCert — detectie-tabel", () => {
  it("geen cert → fail", () => {
    const r = evaluateTlsCert({ cert: null, host: "example.com" });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("geen certificaat");
  });

  it("notBefore > nu (nog niet geldig) → fail", () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const r = evaluateTlsCert({
      cert: cert({ valid_from: inDays(5), valid_to: inDays(90) }),
      host: "example.com",
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("nog niet geldig");
  });

  it("notAfter < nu (verlopen) → fail", () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const r = evaluateTlsCert({
      cert: cert({ valid_from: inDays(-90), valid_to: inDays(-1) }),
      host: "example.com",
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("verlopen");
  });

  it("SAN/CN matcht host niet → fail", () => {
    const r = evaluateTlsCert({
      cert: cert({
        subject: { CN: "other.com" },
        subjectaltname: "DNS:other.com, DNS:www.other.com",
      }),
      host: "example.com",
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("dekt de hostnaam");
  });

  it("notAfter ≤ 30 d in de toekomst → warn", () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const r = evaluateTlsCert({
      cert: cert({ valid_from: inDays(-30), valid_to: inDays(15) }),
      host: "example.com",
    });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("verloopt binnen");
  });

  it("self-signed (issuer.CN == subject.CN) → warn", () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const r = evaluateTlsCert({
      cert: cert({
        subject: { CN: "example.com" },
        issuer: { CN: "example.com" },
        valid_from: inDays(-30),
        valid_to: inDays(120),
      }),
      host: "example.com",
    });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("self-signed");
  });

  it("alles goed, > 30 d runway → pass", () => {
    const r = evaluateTlsCert({ cert: cert(), host: "example.com" });
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("CN=example.com");
  });

  it("wildcard SAN matcht subdomein", () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const r = evaluateTlsCert({
      cert: cert({
        subject: { CN: "*.example.com" },
        subjectaltname: "DNS:*.example.com",
        valid_from: inDays(-30),
        valid_to: inDays(120),
      }),
      host: "foo.example.com",
    });
    expect(r.status).toBe("pass");
  });

  it("evidence bevat notAfter/notBefore/issuer/subject/san als string", () => {
    const r = evaluateTlsCert({ cert: cert(), host: "example.com" });
    expect(typeof r.evidence).toBe("string");
    expect(r.evidence as string).toMatch(/notBefore=/);
    expect(r.evidence as string).toMatch(/notAfter=/);
    expect(r.evidence as string).toMatch(/issuer=Let's Encrypt R3/);
    expect(r.evidence as string).toMatch(/subject=example.com/);
    expect(r.evidence as string).toMatch(/san=/);
  });
});

describe("tlsCertCheck.run", () => {
  it("non-https URL → info", async () => {
    const results = await tlsCertCheck.run(ctx("http://example.com"));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("niet van toepassing");
  });

  it("rate-limit → info", async () => {
    const rate = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const results = await tlsCertCheck.run(ctx("https://example.com", rate));
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("rate-limit");
    expect(rate).toHaveBeenCalledWith("tls-cert:example.com", 10, 60);
  });

  it("secureConnect levert cert → evaluateTlsCert", async () => {
    const peerCert = cert();
    const socket = {
      getPeerCertificate: vi.fn(() => peerCert),
      destroy: vi.fn(),
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "secureConnect") {
          queueMicrotask(() => cb());
        }
        return socket;
      }),
    };
    mockedConnect.mockReturnValue(socket as never);

    const results = await tlsCertCheck.run(ctx("https://example.com"));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
  });

  it("TLS-error → fail", async () => {
    const socket = {
      getPeerCertificate: vi.fn(),
      destroy: vi.fn(),
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "error") {
          queueMicrotask(() => cb(new Error("CERT_HAS_EXPIRED")));
        }
        return socket;
      }),
    };
    mockedConnect.mockReturnValue(socket as never);

    const results = await tlsCertCheck.run(ctx("https://example.com"));
    expect(results[0].status).toBe("fail");
    expect(results[0].detail).toContain("CERT_HAS_EXPIRED");
  });

  it("timeout → fail", async () => {
    const socket = {
      getPeerCertificate: vi.fn(),
      destroy: vi.fn(),
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "timeout") {
          queueMicrotask(() => cb());
        }
        return socket;
      }),
    };
    mockedConnect.mockReturnValue(socket as never);

    const results = await tlsCertCheck.run(ctx("https://example.com"));
    expect(results[0].status).toBe("fail");
    expect(results[0].detail).toContain("time-out");
  });
});
