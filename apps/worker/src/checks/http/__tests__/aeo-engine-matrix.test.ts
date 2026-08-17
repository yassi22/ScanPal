import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  aeoEngineMatrixCheck,
  buildMatrixRow,
  classifyProbe,
  summarizeMatrix,
} from "../aeo-engine-matrix";
import { fetchPage } from "../../types";
import { AI_ENGINE_BOTS, robotsRulesForAgent } from "@scanpal/shared";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

const PARSEABLE_HTML = `<!doctype html><html><head><title>Welkom</title></head>
  <body><h1>Hoofd</h1><p>${"voldoende tekst ".repeat(20)}</p></body></html>`;

function okRateLimit() {
  return vi.fn().mockResolvedValue({ ok: true });
}

function ctx(rateLimit = okRateLimit()) {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: rateLimit as never,
  };
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("classifyProbe (besluit 2b/2c)", () => {
  it("2xx/3xx → bereikbaar met html", () => {
    const r = classifyProbe(200, PARSEABLE_HTML);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(PARSEABLE_HTML);
  });

  it("4xx → niet bereikbaar (WAF)", () => {
    const r = classifyProbe(403, "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("403");
  });

  it("5xx → niet bereikbaar", () => {
    const r = classifyProbe(503, "");
    expect(r.ok).toBe(false);
  });
});

describe("buildMatrixRow (besluit 2a-c)", () => {
  const rules = robotsRulesForAgent(
    "User-agent: *\nDisallow: /private\n",
    "GPTBot",
  );

  it("robots-disallow → reachable=false, geen probe-evaluatie", () => {
    const row = buildMatrixRow({
      engine: "chatgpt",
      userAgentToken: "GPTBot",
      rules: robotsRulesForAgent("User-agent: *\nDisallow: /\n", "GPTBot"),
      path: "/",
      probe: { ok: true, status: 200, html: PARSEABLE_HTML },
    });
    expect(row.reachable).toBe(false);
    expect(row.parseable).toBe(false);
    expect(row.reason).toContain("robots.txt");
  });

  it("WAF-403 → reachable=false", () => {
    const row = buildMatrixRow({
      engine: "claude",
      userAgentToken: "ClaudeBot",
      rules,
      path: "/",
      probe: { ok: false, reason: "HTTP 403 (bot geblokkeerd)" },
    });
    expect(row.reachable).toBe(false);
    expect(row.reason).toContain("403");
  });

  it("parseable html → reachable + parseable", () => {
    const row = buildMatrixRow({
      engine: "perplexity",
      userAgentToken: "PerplexityBot",
      rules,
      path: "/",
      probe: { ok: true, status: 200, html: PARSEABLE_HTML },
    });
    expect(row.reachable).toBe(true);
    expect(row.parseable).toBe(true);
    expect(row.reason).toBe("ok");
  });

  it("JS-only html → bereikbaar maar niet parseerbaar", () => {
    const html = `<html><head><title>T</title></head><body><div id="root"></div></body></html>`;
    const row = buildMatrixRow({
      engine: "google",
      userAgentToken: "Google-Extended",
      rules,
      path: "/",
      probe: { ok: true, status: 200, html },
    });
    expect(row.reachable).toBe(true);
    expect(row.parseable).toBe(false);
    expect(row.reason).toContain("niet parseerbaar");
  });
});

describe("summarizeMatrix", () => {
  it("beschrijft bereik/parseerbaarheid + llms.txt", () => {
    const s = summarizeMatrix(
      [
        { engine: "chatgpt", reachable: true, parseable: true, reason: "ok" },
        { engine: "claude", reachable: false, parseable: false, reason: "WAF" },
      ],
      { present: true, parseable: true, link_errors: [] },
    );
    expect(s).toContain("1/2 bots bereikbaar");
    expect(s).toContain("1/2 bots parseerbaar");
    expect(s).toContain("llms.txt aanwezig");
  });
});

describe("aeoEngineMatrixCheck.run", () => {
  it("haalt robots.txt + llms.txt + 1 probe per niet-geblokkeerde engine; 1 finding", async () => {
    const robots = "User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow:\n";
    const llms = "# Title\n\n- [Docs](https://example.com/docs)\n";

    mockedFetchPage
      // robots.txt
      .mockResolvedValueOnce(new Response(robots, { status: 200 }))
      // llms.txt
      .mockResolvedValueOnce(new Response(llms, { status: 200 }));
    // 6 probes (GPTBot is geblokkeerd door robots → geen probe)
    for (let i = 0; i < 6; i++) {
      mockedFetchPage.mockResolvedValueOnce(
        new Response(PARSEABLE_HTML, { status: 200 }),
      );
    }

    const results = await aeoEngineMatrixCheck.run(ctx());

    // robots + llms + 6 probes = 8 fetchPage-aanroepen.
    expect(mockedFetchPage).toHaveBeenCalledTimes(8);
    expect(mockedFetchPage.mock.calls[0][0]).toBe("https://example.com/robots.txt");
    expect(mockedFetchPage.mock.calls[1][0]).toBe("https://example.com/llms.txt");

    // De GPTBot-probe mag niet zijn uitgevoerd: geen probe-call met GPTBot-UA.
    const probeCalls = mockedFetchPage.mock.calls.slice(2);
    for (const call of probeCalls) {
      const ua = (call[1]?.headers as Record<string, string> | undefined)?.["User-Agent"];
      expect(ua).toBeTruthy();
      expect(ua).not.toContain("GPTBot");
    }

    expect(results).toHaveLength(1);
    const finding = results[0];
    expect(finding.id).toBe("aeo-engine-matrix");
    expect(finding.evidence).toEqual(
      expect.objectContaining({ kind: "aeo-engine-matrix" }),
    );
    const evidence = finding.evidence as { kind: "aeo-engine-matrix"; engine_matrix: { engine: string; reachable: boolean; parseable: boolean; reason: string }[]; llms_txt: { present: boolean; parseable: boolean; link_errors: string[] } };
    expect(evidence.engine_matrix).toHaveLength(7);
    const gptbot = evidence.engine_matrix.find((row) => row.engine === "chatgpt");
    expect(gptbot?.reachable).toBe(false);
    expect(gptbot?.reason).toContain("robots.txt");
    const claude = evidence.engine_matrix.find((row) => row.engine === "claude");
    expect(claude?.reachable).toBe(true);
    expect(claude?.parseable).toBe(true);
    expect(evidence.llms_txt.present).toBe(true);
    expect(evidence.llms_txt.parseable).toBe(true);
    // GPTBot niet bereikbaar → geen pass.
    expect(finding.status).toBe("warn");
    expect(finding.severity).toBe("medium");
  });

  it("alle engines geblokkeerd door WAF (403) → status fail", async () => {
    mockedFetchPage
      .mockResolvedValueOnce(new Response("User-agent: *\nDisallow:\n", { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 })); // llms.txt afwezig
    for (let i = 0; i < AI_ENGINE_BOTS.length; i++) {
      mockedFetchPage.mockResolvedValueOnce(new Response("", { status: 403 }));
    }

    const results = await aeoEngineMatrixCheck.run(ctx());
    const finding = results[0];
    expect(finding.status).toBe("fail");
    expect(finding.severity).toBe("high");
    const evidence = finding.evidence as { engine_matrix: { reachable: boolean }[]; llms_txt: { present: boolean } };
    expect(evidence.engine_matrix.filter((row) => row.reachable)).toHaveLength(0);
    expect(evidence.llms_txt.present).toBe(false);
  });

  it("alles ok + llms.txt aanwezig → status pass", async () => {
    const robots = "User-agent: *\nDisallow:\n";
    const llms = "# Title\n\n- [Docs](https://example.com)\n";
    mockedFetchPage
      .mockResolvedValueOnce(new Response(robots, { status: 200 }))
      .mockResolvedValueOnce(new Response(llms, { status: 200 }));
    for (let i = 0; i < AI_ENGINE_BOTS.length; i++) {
      mockedFetchPage.mockResolvedValueOnce(
        new Response(PARSEABLE_HTML, { status: 200 }),
      );
    }

    const results = await aeoEngineMatrixCheck.run(ctx());
    const finding = results[0];
    expect(finding.status).toBe("pass");
    expect(finding.severity).toBe("info");
  });

  it("rate-limit → robots.txt-fout → info-finding", async () => {
    const rate = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const results = await aeoEngineMatrixCheck.run(ctx(rate as never));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("niet controleerbaar");
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });
});
