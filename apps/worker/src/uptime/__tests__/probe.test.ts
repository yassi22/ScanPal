import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrl, ConcurrencyGate } from "../probe";

function okResponse(init: ResponseInit = {}) {
  return new Response("ok", { status: 200, ...init });
}

describe("probeUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("geeft invalid-url voor een ongeldige URL", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await probeUrl("geen geldige url");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid-url");
    expect(result.status).toBe("down");
  });

  it("markeert < 500 als up met latency en status_code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("up");
    expect(result.status_code).toBe(200);
    expect(result.error).toBeNull();
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://voorbeeld.nl",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("markeert >= 500 als down (http-5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ status: 503 })),
    );
    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("down");
    expect(result.status_code).toBe(503);
    expect(result.error).toBe("http-5xx");
    expect(result.latency_ms).toBeNull();
  });

  it("telt max 5 redirects en geeft dan too-many-redirects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ status: 302, headers: { location: "/next" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("too-many-redirects");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("volgt redirects binnen de limiet en neemt de eindstatus", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({ status: 301, headers: { location: "https://voorbeeld.nl/home" } }),
      )
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(true);
    expect(result.status_code).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("behandelt een timeout als down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }),
    );

    const result = await probeUrl("https://voorbeeld.nl", { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("doet een http-fallback bij een connect-fout op https", async () => {
    const connectError = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectError)
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("up");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://voorbeeld.nl",
      expect.anything(),
    );
  });

  it("doet een http-fallback bij een TLS-fout op https", async () => {
    const tlsError = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("certificate has expired"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(tlsError));
    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("tls");
  });

  it("geeft geen fallback bij een 5xx-status op https", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeUrl("https://voorbeeld.nl");
    expect(result.ok).toBe(false);
    expect(result.status_code).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gebruikt de canonieke URL (www + protocol gestript)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    await probeUrl("https://www.voorbeeld.nl");
    expect(fetchMock).toHaveBeenCalledWith("https://voorbeeld.nl", expect.anything());
  });
});

describe("ConcurrencyGate", () => {
  it("beperkt het aantal gelijktijdige taken", async () => {
    const gate = new ConcurrencyGate(2);
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };

    await Promise.all(Array.from({ length: 6 }, () => gate.run(task)));
    expect(maxActive).toBe(2);
  });
});
