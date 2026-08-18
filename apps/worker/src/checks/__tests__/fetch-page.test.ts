import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  assertOutboundAllowed,
  fetchPage,
  redirectChainOf,
} from "../types";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === "internal.corp") return [{ address: "10.0.0.8" }];
    if (host === "public.example") return [{ address: "93.184.216.34" }];
    return [];
  }),
}));

function okResponse(body = "<html>ok</html>") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("assertOutboundAllowed (SSRF-guard)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("weigert loopback/private/link-local IP-literal targets", async () => {
    expect(await assertOutboundAllowed("http://127.0.0.1/x")).toBe("blocked-ip");
    expect(await assertOutboundAllowed("https://169.254.169.254/latest/meta-data")).toBe(
      "blocked-ip",
    );
    expect(await assertOutboundAllowed("http://10.0.0.5/")).toBe("blocked-ip");
    expect(await assertOutboundAllowed("http://192.168.1.1/")).toBe("blocked-ip");
    expect(await assertOutboundAllowed("http://[::1]/")).toBe("blocked-ip");
  });

  it("weigert localhost en .local/.internal hostnames", async () => {
    expect(await assertOutboundAllowed("http://localhost:8080/x")).toBe("localhost");
    expect(await assertOutboundAllowed("http://foo.local/x")).toBe("localhost");
    expect(await assertOutboundAllowed("http://internal.corp/x")).toBe(
      "resolved-blocked-ip",
    );
  });

  it("weigert niet-http(s) protocollen", async () => {
    expect(await assertOutboundAllowed("file:///etc/passwd")).toBe("protocol");
    expect(await assertOutboundAllowed("ftp://example.com/x")).toBe("protocol");
  });

  it("staat publieke https-targets toe", async () => {
    expect(await assertOutboundAllowed("https://public.example/x")).toBeNull();
  });

  it("weigert ongeldige URL's", async () => {
    expect(await assertOutboundAllowed("geen url")).toBe("invalid-url");
  });
});

describe("fetchPage (SSRF + size-cap + redirects)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blokkeert een fetch naar een privé-target voordat er netwerk plaatsvindt", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPage("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      "blocked",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blokkeert redirect-hops naar private targets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/x" },
        }),
      )
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPage("https://public.example/start")).rejects.toThrow(
      "blocked",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("volgt redirects (SSRF-geguard) en stelt de ketting beschikbaar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://public.example/final" },
        }),
      )
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchPage("https://public.example/start");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>ok</html>");
    expect(redirectChainOf(res)).toEqual(["https://public.example/final"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("geeft een body-groter-dan-cap als fout bij .text()", async () => {
    const big = "x".repeat(DEFAULT_MAX_RESPONSE_BYTES + 1024);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(big)));

    const res = await fetchPage("https://public.example/");
    await expect(res.text()).rejects.toThrow("exceeds");
  });
});
