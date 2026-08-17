import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../client";
import { createScanpalServer, toolDefs } from "../server";

const API_KEY = "sp_live_testkey";
const BASE_URL = "https://app.example.com";

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

    await client.runScan({ site_id: "00000000-0000-4000-8000-000000000001" });
    await client.getScan("00000000-0000-4000-8000-000000000002");
    await client.getFindings("00000000-0000-4000-8000-000000000002", {
      severity: "critical",
      status: "open",
    });
    await client.listSites();
    await client.getFixPrompt("00000000-0000-4000-8000-000000000002");

    const paths = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(paths[0]).toBe(
      "https://app.example.com/api/scans",
    );
    expect(paths[1]).toBe(
      "https://app.example.com/api/scans/00000000-0000-4000-8000-000000000002",
    );
    expect(paths[2]).toBe(
      "https://app.example.com/api/scans/00000000-0000-4000-8000-000000000002/findings?severity=critical&status=open",
    );
    expect(paths[3]).toBe("https://app.example.com/api/sites");
    expect(paths[4]).toBe(
      "https://app.example.com/api/scans/00000000-0000-4000-8000-000000000002/fix-prompt",
    );
  });

  it("POST /api/scans stuurt een JSON-body", async () => {
    mockFetch({ status: 202, body: { scan: { id: "scan-1" } } });
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await client.runScan({ site_id: "00000000-0000-4000-8000-000000000001" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ site_id: "00000000-0000-4000-8000-000000000001" }),
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
  it("registreert de 6 tools (smoke)", () => {
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const server = createScanpalServer(client);

    expect(toolDefs.map((tool) => tool.name)).toEqual([
      "run_scan",
      "get_scan",
      "get_findings",
      "list_sites",
      "get_uptime",
      "generate_fix_prompt",
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
    } as unknown as ReturnType<typeof createApiClient>;

    const byName = new Map(toolDefs.map((tool) => [tool.name, tool.handler(client)]));

    const runScanResult = await byName.get("run_scan")!({
      site_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(client.runScan).toHaveBeenCalledWith({
      site_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(runScanResult.content[0].text).toContain("scan-1");

    await byName.get("get_scan")!({ id: "00000000-0000-4000-8000-000000000002" });
    expect(client.getScan).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002");

    await byName.get("get_findings")!({
      id: "00000000-0000-4000-8000-000000000002",
      severity: "critical",
      status: "open",
    });
    expect(client.getFindings).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      { severity: "critical", status: "open" },
    );

    await byName.get("list_sites")!({});
    expect(client.listSites).toHaveBeenCalled();

    await byName.get("get_uptime")!({});
    expect(client.getUptime).toHaveBeenCalled();

    await byName.get("generate_fix_prompt")!({
      id: "00000000-0000-4000-8000-000000000002",
    });
    expect(client.getFixPrompt).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
    );
  });

  it("geeft client-fouten door als tool-fout (bijv. rate-limit)", async () => {
    const client = createApiClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    mockFetch({ status: 429, body: { error: "Te veel verzoeken" } });

    const handler = toolDefs.find((tool) => tool.name === "list_sites")!.handler(client);
    await expect(handler({})).rejects.toThrow("Rate-limit bereikt (429)");
  });
});
