import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpToolDefinitions } from "@scanpal/shared";
import { ApiError, createApiClient } from "../client";
import { createScanpalServer, handlers } from "../server";

const API_KEY = "sp_live_testkey";
const BASE_URL = "https://app.example.com";

const SCAN_ID = "00000000-0000-4000-8000-000000000001";
const SITE_ID = "00000000-0000-4000-8000-000000000002";
const FINDING_ID = "https:https-ontbreekt";

type MockResponse = {
  status?: number;
  body?: unknown;
};

function mockFetch(response: MockResponse): void {
  const status = response.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => response.body ?? {},
    } as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiClient", () => {
  it("stuurt Bearer-header mee op alle verzoeken", async () => {
    mockFetch({ status: 200, body: { sites: [] } });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await client.listSites();
    await client.getUptime();

    const calls = vi.mocked(fetch).mock.calls;
    for (const [url, init] of calls) {
      expect(String(url)).toMatch(/^https:\/\/app\.example\.com\/api\//);
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: `Bearer ${API_KEY}`,
      });
    }
    expect(calls).toHaveLength(2);
  });

  it("bouwt de juiste REST-paden", async () => {
    mockFetch({ status: 200, body: {} });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await client.runScan({ site_id: SITE_ID });
    await client.getScan(SCAN_ID);
    await client.getFindings(SCAN_ID, { severity: "critical", status: "open" });
    await client.listSites();
    await client.getFixPrompt(SCAN_ID);
    await client.listFindings(SCAN_ID, { severity: "high", route_url: "/admin" });
    await client.getFinding(SCAN_ID, FINDING_ID);
    await client.dismissFinding(SCAN_ID, FINDING_ID, {
      status: "fixed",
      note: "opgelost",
    });
    await client.getScanDiff(SCAN_ID);
    await client.listScans({ site_id: SITE_ID });
    await client.getSite(SITE_ID);
    await client.getUptimeHistory(SITE_ID, 90);

    const paths = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(paths[0]).toBe("https://app.example.com/api/scans");
    expect(paths[1]).toBe(`https://app.example.com/api/scans/${SCAN_ID}`);
    expect(paths[2]).toBe(
      `https://app.example.com/api/scans/${SCAN_ID}/findings?severity=critical&status=open`,
    );
    expect(paths[3]).toBe("https://app.example.com/api/sites");
    expect(paths[4]).toBe(
      `https://app.example.com/api/scans/${SCAN_ID}/fix-prompt`,
    );
    expect(paths[5]).toBe(
      `https://app.example.com/api/scans/${SCAN_ID}/findings?severity=high&route_url=%2Fadmin`,
    );
    expect(paths[6]).toBe(
      `https://app.example.com/api/scans/${SCAN_ID}/findings/${encodeURIComponent(FINDING_ID)}`,
    );
    expect(paths[7]).toBe(
      `https://app.example.com/api/scans/${SCAN_ID}/findings/${encodeURIComponent(FINDING_ID)}`,
    );
    expect(paths[8]).toBe(`https://app.example.com/api/scans/${SCAN_ID}/diff`);
    expect(paths[9]).toBe(
      `https://app.example.com/api/scans?site_id=${SITE_ID}`,
    );
    expect(paths[10]).toBe(`https://app.example.com/api/sites/${SITE_ID}`);
    expect(paths[11]).toBe(`https://app.example.com/api/uptime/sites/${SITE_ID}?days=90`);
  });

  it("POST /api/scans stuurt een JSON-body", async () => {
    mockFetch({ status: 202, body: { scan: { id: "scan-1" } } });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await client.runScan({ site_id: SITE_ID });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ site_id: SITE_ID }),
    );
  });

  it("PATCH finding stuurt de dismiss-body (fixed/ignored + note)", async () => {
    mockFetch({ status: 200, body: {} });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await client.dismissFinding(SCAN_ID, FINDING_ID, {
      status: "ignored",
      note: "bewuste keuze",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ status: "ignored", note: "bewuste keuze" }),
    );
  });

  it("mappt HTTP-fouten naar leesbare tool-errors", async () => {
    mockFetch({ status: 404, body: { error: "Not found" } });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.getScan("onbekend")).rejects.toThrow(
      "Site of scan niet gevonden (404)",
    );
  });

  it("mappt 401 naar auth-fout", async () => {
    mockFetch({ status: 401, body: { error: "Unauthorized" } });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.listSites()).rejects.toThrow(
      "Auth-mislukt — controleer de API-key",
    );
  });

  it("mappt 429 naar rate-limit-fout", async () => {
    mockFetch({ status: 429, body: { error: "Te veel verzoeken" } });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    const error = (await client.listSites().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.message).toContain("Rate-limit bereikt");
  });
});

describe("createScanpalServer", () => {
  it("registreert 14 tools (smoke)", () => {
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const server = createScanpalServer(client);

    expect(mcpToolDefinitions.map((tool) => tool.name)).toEqual([
      "run_scan",
      "get_scan",
      "get_findings",
      "list_findings",
      "get_finding",
      "dismiss_finding",
      "get_scan_diff",
      "list_scans",
      "list_sites",
      "get_site",
      "get_uptime",
      "get_uptime_history",
      "generate_fix_prompt",
      "list_checks",
    ]);
    expect(server.isConnected()).toBe(false);
  });

  it("wired handlers roepen de juiste client-methode aan en retourneren text", async () => {
    const client = {
      runScan: vi.fn().mockResolvedValue({ scan: { id: "scan-1" } }),
      getScan: vi.fn().mockResolvedValue({ status: "running" }),
      getFindings: vi.fn().mockResolvedValue({ findings: [] }),
      listSites: vi.fn().mockResolvedValue({ sites: [] }),
      getUptime: vi.fn().mockResolvedValue({ sites: [] }),
      getFixPrompt: vi.fn().mockResolvedValue({
        prompt: "# Fix prompt",
        findings_covered: 1,
        truncated: false,
      }),
      listFindings: vi.fn().mockResolvedValue({ findings: [], total: 0 }),
      getFinding: vi.fn().mockResolvedValue({ id: FINDING_ID }),
      dismissFinding: vi.fn().mockResolvedValue({ id: FINDING_ID }),
      getScanDiff: vi.fn().mockResolvedValue({ diff: {}, findings: [] }),
      listScans: vi.fn().mockResolvedValue({ scans: [] }),
      getSite: vi.fn().mockResolvedValue({ site: {} }),
      getUptimeHistory: vi.fn().mockResolvedValue({ summary: {} }),
    } as unknown as ReturnType<typeof createApiClient>;

    const byName = new Map(
      mcpToolDefinitions.map((tool) => [tool.name, handlers[tool.name](client)]),
    );

    const runScanResult = await byName.get("run_scan")!({ site_id: SITE_ID });
    expect(client.runScan).toHaveBeenCalledWith({ site_id: SITE_ID });
    expect(runScanResult.content[0].text).toContain("scan-1");

    await byName.get("get_scan")!({ id: SCAN_ID });
    expect(client.getScan).toHaveBeenCalledWith(SCAN_ID);

    await byName.get("get_findings")!({
      id: SCAN_ID,
      severity: "critical",
      status: "open",
    });
    expect(client.getFindings).toHaveBeenCalledWith(SCAN_ID, {
      severity: "critical",
      status: "open",
    });

    await byName.get("list_findings")!({
      scan_id: SCAN_ID,
      severity: "high",
      route_url: "/admin",
      limit: 25,
    });
    expect(client.listFindings).toHaveBeenCalledWith(SCAN_ID, {
      severity: "high",
      route_url: "/admin",
      limit: 25,
    });

    await byName.get("get_finding")!({ scan_id: SCAN_ID, finding_id: FINDING_ID });
    expect(client.getFinding).toHaveBeenCalledWith(SCAN_ID, FINDING_ID);

    await byName.get("dismiss_finding")!({
      scan_id: SCAN_ID,
      finding_id: FINDING_ID,
      status: "ignored",
      note: "bewuste keuze",
    });
    expect(client.dismissFinding).toHaveBeenCalledWith(SCAN_ID, FINDING_ID, {
      status: "ignored",
      note: "bewuste keuze",
    });

    await byName.get("get_scan_diff")!({ scan_id: SCAN_ID });
    expect(client.getScanDiff).toHaveBeenCalledWith(SCAN_ID);

    await byName.get("list_scans")!({ site_id: SITE_ID });
    expect(client.listScans).toHaveBeenCalledWith({ site_id: SITE_ID });

    await byName.get("list_sites")!({});
    expect(client.listSites).toHaveBeenCalled();

    await byName.get("get_site")!({ site_id: SITE_ID });
    expect(client.getSite).toHaveBeenCalledWith(SITE_ID);

    await byName.get("get_uptime")!({});
    expect(client.getUptime).toHaveBeenCalled();

    await byName.get("get_uptime_history")!({ site_id: SITE_ID, days: 90 });
    expect(client.getUptimeHistory).toHaveBeenCalledWith(SITE_ID, 90);

    await byName.get("generate_fix_prompt")!({ id: SCAN_ID });
    expect(client.getFixPrompt).toHaveBeenCalledWith(SCAN_ID);

    const checksResult = await byName.get("list_checks")!({});
    expect(JSON.parse(checksResult.content[0].text).length).toBeGreaterThan(0);
  });

  it("geeft client-fouten door als tool-fout (bijv. rate-limit)", async () => {
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    mockFetch({ status: 429, body: { error: "Te veel verzoeken" } });

    const handler = handlers["list_sites"](client);
    await expect(handler({})).rejects.toThrow("Rate-limit bereikt (429)");
  });

  it("elke tool-definitie heeft een REST-mapping (1 tool = 1 endpoint)", () => {
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    for (const tool of mcpToolDefinitions) {
      expect(handlers[tool.name]).toBeDefined();
      expect(typeof handlers[tool.name](client)).toBe("function");
    }
  });
});
