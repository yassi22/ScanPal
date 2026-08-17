import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SPOOFED_ORIGIN,
  corsCheck,
  evaluateCors,
} from "../cors";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);
const NAME = "CORS-configuratie";

beforeEach(() => {
  mockedFetchPage.mockReset();
});

function okRateLimit() {
  return vi.fn().mockResolvedValue({ ok: true });
}

function ctx(rateLimit = okRateLimit()) {
  return {
    url: "https://example.com",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: rateLimit as never,
  };
}

describe("evaluateCors — detectie-tabel", () => {
  it("ACAO == spoofed origin + ACAC: true → fail", () => {
    const r = evaluateCors(
      { acao: SPOOFED_ORIGIN, acac: "true", nullAcao: null },
      NAME,
    );
    expect(r.status).toBe("fail");
    expect(r.evidence).toBe(`ACAO=${SPOOFED_ORIGIN}; ACAC=true`);
  });

  it("ACAO == spoofed origin zonder credentials → warn", () => {
    const r = evaluateCors(
      { acao: SPOOFED_ORIGIN, acac: null, nullAcao: null },
      NAME,
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain(SPOOFED_ORIGIN);
  });

  it("ACAO reflecteert null (probe #2) → warn", () => {
    const r = evaluateCors(
      { acao: null, acac: null, nullAcao: "null" },
      NAME,
    );
    expect(r.status).toBe("warn");
    expect(r.evidence).toBe("ACAO(null-probe)=null");
  });

  it("ACAO == * + ACAC: true (ongeldige combinatie) → warn", () => {
    const r = evaluateCors(
      { acao: "*", acac: "true", nullAcao: null },
      NAME,
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("Ongeldige CORS-combinatie");
  });

  it("ACAO == * zonder credentials → info", () => {
    const r = evaluateCors(
      { acao: "*", acac: null, nullAcao: null },
      NAME,
    );
    expect(r.status).toBe("info");
  });

  it("geen ACAO-header (vaste allowlist / afwezig) → pass", () => {
    const r = evaluateCors(
      { acao: null, acac: null, nullAcao: null },
      NAME,
    );
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("geen arbitraire origin-acceptatie");
  });

  it("vaste ACAO-waarde zonder reflectie → pass", () => {
    const r = evaluateCors(
      { acao: "https://trusted.example", acac: "true", nullAcao: "https://trusted.example" },
      NAME,
    );
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("https://trusted.example");
  });

  it("spoofed-reflectie met credentials wint van null-reflectie (precedentie)", () => {
    const r = evaluateCors(
      { acao: SPOOFED_ORIGIN, acac: "true", nullAcao: "null" },
      NAME,
    );
    expect(r.status).toBe("fail");
  });
});

describe("corsCheck.run", () => {
  it("doet twee fetchPage-aanroepen met Origin-headers en levert één finding", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            "access-control-allow-origin": SPOOFED_ORIGIN,
            "access-control-allow-credentials": "true",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, { headers: { "access-control-allow-origin": "null" } }),
      );
    const rate = okRateLimit();

    const results = await corsCheck.run(ctx(rate));

    expect(mockedFetchPage).toHaveBeenCalledTimes(2);
    expect(mockedFetchPage.mock.calls[0][1]?.headers).toEqual({ Origin: SPOOFED_ORIGIN });
    expect(mockedFetchPage.mock.calls[1][1]?.headers).toEqual({ Origin: "null" });
    // Per-host rate-limit voor beide probes.
    expect(rate).toHaveBeenCalledTimes(2);
    expect(rate).toHaveBeenCalledWith("cors:example.com", 10, 60);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("cors");
    expect(results[0].status).toBe("fail");
  });

  it("geeft info-finding als de pagina niet bereikbaar is", async () => {
    mockedFetchPage.mockRejectedValueOnce(new Error("timeout"));
    const results = await corsCheck.run(ctx());
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("niet controleerbaar");
  });

  it("geeft info-finding bij rate-limit", async () => {
    const rate = vi
      .fn()
      .mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const results = await corsCheck.run(ctx(rate));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("rate-limit");
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });
});
