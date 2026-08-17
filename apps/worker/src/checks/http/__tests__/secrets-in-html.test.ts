import { describe, it, expect, vi, beforeEach } from "vitest";
import { secretsInHtmlCheck } from "../secrets-in-html";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

const STRIPE_SECRET = "sk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz";
const STRIPE_PUBLISHABLE = "pk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz";

function ctx() {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function htmlResponse(body: string, contentType = "text/html; charset=utf-8") {
  return {
    headers: { get: (name: string) => (name === "content-type" ? contentType : null) },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function htmlEvidence(result: Awaited<ReturnType<typeof secretsInHtmlCheck.run>>[0]) {
  return result.evidence as {
    kind: "secrets-in-html";
    matches: {
      key_type: string;
      provider: string;
      location: string;
      match_preview: string;
      severity: string;
    }[];
    notes: string[];
  };
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("secretsInHtmlCheck (feature 33)", () => {
  it("fail bij een kritieke key in inline <script>", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(`<html><body>
        <script>const KEY = "${STRIPE_SECRET}";</script>
      </body></html>`),
    );
    const [result] = await secretsInHtmlCheck.run(ctx());
    expect(result.id).toBe("secrets-in-html");
    expect(result.status).toBe("fail");
    expect(result.severity).toBe("critical");
    const evidence = htmlEvidence(result);
    expect(evidence.matches).toHaveLength(1);
    expect(evidence.matches[0]).toEqual({
      key_type: "stripe_secret_key",
      provider: "stripe",
      location: "inline-script",
      match_preview: "sk_l…WxYz",
      severity: "critical",
    });
    expect(JSON.stringify(evidence)).not.toContain(STRIPE_SECRET);
    expect(result.detail).not.toContain(STRIPE_SECRET);
  });

  it("warn bij een low-severity publishable key", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(`<script>const PK = "${STRIPE_PUBLISHABLE}";</script>`),
    );
    const [result] = await secretsInHtmlCheck.run(ctx());
    expect(result.status).toBe("warn");
    expect(result.severity).toBe("low");
    expect(result.detail).toContain("1 geheim(en)");
  });

  it("pass bij een pagina zonder secrets", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(`<html><body><p>schone pagina</p></body></html>`),
    );
    const [result] = await secretsInHtmlCheck.run(ctx());
    expect(result.status).toBe("pass");
    expect(result.evidence).toBeNull();
    expect(result.detail).toContain("Geen geheimen gevonden");
  });

  it("info bij non-html content-type", async () => {
    mockedFetchPage.mockResolvedValue(htmlResponse("{}", "application/json"));
    const [result] = await secretsInHtmlCheck.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("niet controleerbaar");
  });

  it("info bij fetch-fout (geen crash)", async () => {
    mockedFetchPage.mockRejectedValue(new Error("network down"));
    const [result] = await secretsInHtmlCheck.run(ctx());
    expect(result.status).toBe("info");
    expect(result.detail).toContain("niet controleerbaar");
  });

  it("vindt keys in HTML-commentaar met locatie html-comment", async () => {
    mockedFetchPage.mockResolvedValue(
      htmlResponse(`<!-- ghp_abcdefghijklmnopqrstuvwxyz0123456789AB -->`),
    );
    const [result] = await secretsInHtmlCheck.run(ctx());
    expect(result.status).toBe("fail");
    const evidence = htmlEvidence(result);
    expect(evidence.matches[0].location).toBe("html-comment");
    expect(evidence.matches[0].provider).toBe("github");
  });
});
