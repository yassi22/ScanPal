import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/public/status/[slug]/route";
import { getPublicStatus } from "@/lib/public-status-core";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/public-status-core", () => ({
  getPublicStatus: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

const getPublicStatusMock = vi.mocked(getPublicStatus);
const rateLimitMock = vi.mocked(checkRateLimit);

const SLUG = "abc123def4567890";

const STATUS = {
  site_host: "voorbeeld.nl",
  status: "up",
  uptime_30d: 99.98,
  uptime_90d: 99.99,
  series: [{ day: "2026-08-16", status: "up" }],
  incidents: [],
};

function getResponse(
  slug: string,
  headers: Record<string, string> = {},
  query = "",
): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/public/status/${slug}${query}`, {
    headers,
  });
  return GET(request, { params: Promise.resolve({ slug }) });
}

describe("GET /api/public/status/[slug]", () => {
  beforeEach(() => {
    getPublicStatusMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue({ ok: true } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 404 voor een niet-herkend slug-formaat", async () => {
    const response = await getResponse("niet-hex-slug-!");
    expect(response.status).toBe(404);
    expect(getPublicStatusMock).not.toHaveBeenCalled();
  });

  it("geeft 404 voor een onbekende slug (geen existence-leak)", async () => {
    getPublicStatusMock.mockResolvedValue(null as never);
    const response = await getResponse(SLUG);
    expect(response.status).toBe(404);
  });

  it("retourneert de publieke status met cache- en noindex-headers", async () => {
    getPublicStatusMock.mockResolvedValue(STATUS as never);
    const response = await getResponse(SLUG);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.site_host).toBe("voorbeeld.nl");
    expect(body.uptime_30d).toBe(99.98);
    expect(body.series).toHaveLength(1);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("vraagt de 90-dagen-serie bij ?days=90", async () => {
    getPublicStatusMock.mockResolvedValue(STATUS as never);
    await getResponse(SLUG, {}, "?days=90");
    expect(getPublicStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      SLUG,
      90,
    );
  });

  it("rate-limit per IP → 429 met Retry-After", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfterSeconds: 42 } as never);
    const response = await getResponse(SLUG, {
      "x-forwarded-for": "203.0.113.10",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(rateLimitMock).toHaveBeenCalledWith("public:203.0.113.10", 60);
  });

  it("stript findings/scores/team-data uit de respons (schema-afdwinging)", async () => {
    const leaked = {
      ...STATUS,
      last_scan_score: 95,
      findings: [{ severity: "high" }],
      team_id: "team-1",
    };
    getPublicStatusMock.mockResolvedValue(leaked as never);
    const response = await getResponse(SLUG);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("findings");
    expect(body).not.toHaveProperty("last_scan_score");
    expect(body).not.toHaveProperty("team_id");
  });
});