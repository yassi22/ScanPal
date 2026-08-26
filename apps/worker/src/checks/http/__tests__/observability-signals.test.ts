import { describe, it, expect, vi, beforeEach } from "vitest";
import { observabilitySignalsCheck } from "../observability-signals";
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

function htmlResponse(
  headers: Record<string, string>,
  html = "",
): Response {
  const h = new Headers({ "content-type": "text/html", ...headers });
  return { headers: h, text: () => Promise.resolve(html) } as unknown as Response;
}

function securityTxtResponse(text: string): Response {
  return {
    headers: new Headers({ "content-type": "text/plain" }),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("observabilitySignalsCheck", () => {
  it("pass bij CSP report-uri (security.txt afwezig)", async () => {
    mockedFetchPage.mockImplementation((url) => {
      if (String(url).includes("security.txt")) {
        return Promise.reject(new Error("404"));
      }
      return Promise.resolve(
        htmlResponse({ "content-security-policy": "default-src 'self'; report-uri /csp-report" }),
      );
    });
    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
    expect(result.detail).toContain("csp-report-uri");
    expect(result.evidence).toMatchObject({
      kind: "observability-signals",
      reporting_headers: ["csp-report-uri"],
      security_txt: false,
    });
  });

  it("pass bij bekende RUM-beacon in HTML", async () => {
    mockedFetchPage.mockImplementation((url) => {
      if (String(url).includes("security.txt")) {
        return Promise.reject(new Error("404"));
      }
      return Promise.resolve(
        htmlResponse({}, '<script src="https://browser.sentry-cdn.com/bundle.js"></script>'),
      );
    });
    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
    expect(result.detail).toContain("Sentry");
  });

  it("pass bij security.txt met Contact-veld", async () => {
    mockedFetchPage.mockImplementation((url) => {
      if (String(url).includes("security.txt")) {
        return Promise.resolve(
          securityTxtResponse("Contact: mailto:security@example.com\nExpires: 2099-01-01T00:00:00Z\n"),
        );
      }
      return Promise.resolve(htmlResponse({}));
    });
    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.severity).toBe("info");
    expect(result.evidence).toMatchObject({ security_txt: true });
  });

  it("geen signalen → status info, severity low, disclaimer-tekst — NOOIT medium/high", async () => {
    mockedFetchPage.mockImplementation((url) => {
      if (String(url).includes("security.txt")) {
        return Promise.reject(new Error("404"));
      }
      return Promise.resolve(htmlResponse({}));
    });
    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("info");
    expect(result.severity).toBe("low");
    expect(result.severity).not.toBe("medium");
    expect(result.severity).not.toBe("high");
    expect(result.detail).toContain("bewijst NIET dat er geen audit-logging is");
    expect(result.evidence).toMatchObject({
      kind: "observability-signals",
      reporting_headers: [],
      beacons: [],
      security_txt: false,
    });
  });

  it("security.txt-fetch respecteert de rate-limit (skip zonder straf)", async () => {
    mockedFetchPage.mockImplementation((url) => {
      if (String(url).includes("security.txt")) {
        throw new Error("mag niet gebeuren — rate-limit had dit moeten blokkeren");
      }
      return Promise.resolve(htmlResponse({}));
    });
    const rateLimit = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const [result] = await observabilitySignalsCheck.run({
      ...ctx(),
      rateLimit: rateLimit as never,
    });
    expect(result.status).toBe("info");
    expect(result.evidence).toMatchObject({ security_txt: false });
  });

  it("warn bij fetch-fout op de homepage, maar severity blijft low (nooit medium/high)", async () => {
    mockedFetchPage.mockRejectedValue(new Error("timeout"));
    const [result] = await observabilitySignalsCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.severity).toBe("low");
    expect(result.detail).toContain("timeout");
  });
});
