export type ApiClientOptions = {
  baseUrl: string;
  apiKey: string;
};

export type ApiClient = {
  runScan(input: { site_id: string }): Promise<unknown>;
  getScan(id: string): Promise<unknown>;
  getFindings(id: string, query?: Record<string, string>): Promise<unknown>;
  listSites(): Promise<unknown>;
  getUptime(): Promise<unknown>;
  getFixPrompt(id: string): Promise<unknown>;
  listFindings(scanId: string, query?: Record<string, string>): Promise<unknown>;
  getFinding(scanId: string, findingId: string): Promise<unknown>;
  dismissFinding(
    scanId: string,
    findingId: string,
    body: { status: string; note?: string },
  ): Promise<unknown>;
  getScanDiff(scanId: string): Promise<unknown>;
  listScans(query?: Record<string, string>): Promise<unknown>;
  getSite(siteId: string): Promise<unknown>;
  getUptimeHistory(siteId: string, days: number): Promise<unknown>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function mapError(status: number): string {
  switch (status) {
    case 401:
      return "Auth-mislukt — controleer de API-key";
    case 403:
      return "Geen toegang (403)";
    case 404:
      return "Site of scan niet gevonden (404)";
    case 429:
      return "Rate-limit bereikt (429) — wacht even en probeer opnieuw";
    default:
      return `API-fout (${status})`;
  }
}

/** Thin HTTP-client over de ScanPal REST API met `Authorization: Bearer`. */
export function createApiClient({ baseUrl, apiKey }: ApiClientOptions): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${base}${path}`, { ...init, headers });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(mapError(response.status), response.status, body);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  return {
    runScan: (input) =>
      request("/api/scans", { method: "POST", body: JSON.stringify(input) }),
    getScan: (id) => request(`/api/scans/${encodeURIComponent(id)}`),
    getFindings: (id, query = {}) => {
      const qs = new URLSearchParams(query).toString();
      return request(
        `/api/scans/${encodeURIComponent(id)}/findings${qs ? `?${qs}` : ""}`,
      );
    },
    listSites: () => request("/api/sites"),
    getUptime: () => request("/api/uptime"),
    getFixPrompt: (id) =>
      request(`/api/scans/${encodeURIComponent(id)}/fix-prompt`),
    listFindings: (scanId, query = {}) => {
      const qs = new URLSearchParams(query).toString();
      return request(
        `/api/scans/${encodeURIComponent(scanId)}/findings${qs ? `?${qs}` : ""}`,
      );
    },
    getFinding: (scanId, findingId) =>
      request(
        `/api/scans/${encodeURIComponent(scanId)}/findings/${encodeURIComponent(findingId)}`,
      ),
    dismissFinding: (scanId, findingId, body) =>
      request(
        `/api/scans/${encodeURIComponent(scanId)}/findings/${encodeURIComponent(findingId)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    getScanDiff: (scanId) =>
      request(`/api/scans/${encodeURIComponent(scanId)}/diff`),
    listScans: (query = {}) => {
      const qs = new URLSearchParams(query).toString();
      return request(`/api/scans${qs ? `?${qs}` : ""}`);
    },
    getSite: (siteId) => request(`/api/sites/${encodeURIComponent(siteId)}`),
    getUptimeHistory: (siteId, days) =>
      request(`/api/uptime/sites/${encodeURIComponent(siteId)}?days=${days}`),
  };
}
