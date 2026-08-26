import { describe, it, expect, vi, beforeEach } from "vitest";
import { observabilitySignalsCheck } from "../observability";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function ctx(url = "https://example.com/") {
  return {
    url,
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function response({
  headers = {},
  body = "",
  ok = true,
}: {
  headers?: Record<string, string>;
  body?: string;
  ok?: boolean;
}): Response {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return { ok, headers: h, text: () => Promise.resolve(body) } as unknown as Response;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("observabilitySignalsCheck", () => {
  it("pass met signalen: NEL-header + Sentry-beacon + security.txt", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(
        response({
          headers: { nel: '{"report_to":"default"}' },
          body: '<script src="https://browser.sentry-cdn.com/7/bundle.js"></script>',
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, body: "Contact: mailto:sec@example.com" }));

    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
    expect(result.detail).toContain("NEL");
    expect(result.detail).toContain("Sentry");
    expect(result.active).toBeFalsy();
    expect(result.evidence).toMatchObject({
      kind: "observability",
      security_txt: true,
    });
  });

  it("straft afwezigheid niet: info-severity met disclaimer, geen security.txt", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(response({ headers: { server: "nginx" }, body: "<h1>hi</h1>" }))
      .mockResolvedValueOnce(response({ ok: false, body: "" }));

    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("info");
    expect(result.severity).toBe("info");
    expect(result.detail.toLowerCase()).toContain("bewijst niet");
    expect(result.active).toBeFalsy();
    expect(result.evidence).toMatchObject({ kind: "observability", security_txt: false });
  });

  it("blijft info (geen straf) als de homepage-fetch faalt", async () => {
    mockedFetchPage.mockRejectedValue(new Error("timeout"));
    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.severity).toBe("info");
    expect(result.active).toBeFalsy();
  });

  it("telt een 200 zonder `Contact:`-veld (SPA soft-404) niet als security.txt", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(response({ headers: { server: "nginx" }, body: "<h1>hi</h1>" }))
      .mockResolvedValueOnce(response({ ok: true, body: "<!doctype html><h1>home</h1>" }));

    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.evidence).toMatchObject({ kind: "observability", security_txt: false });
  });

  it("gate de security.txt-fetch achter de per-host rate-limit", async () => {
    const c = ctx();
    // Homepage-fetch lukt; de rate-limit weigert de extra security.txt-GET.
    mockedFetchPage.mockResolvedValueOnce(
      response({ headers: { server: "nginx" }, body: "<h1>hi</h1>" }),
    );
    (c.rateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      retryAfterSeconds: 42,
    });

    const [result] = await observabilitySignalsCheck.run(c);
    // Geweigerde rate-limit → geen tweede fetch, security.txt telt als afwezig.
    expect(mockedFetchPage).toHaveBeenCalledTimes(1);
    expect(result.evidence).toMatchObject({ kind: "observability", security_txt: false });
  });
});
