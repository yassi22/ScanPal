import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/h/[token]/route";
import {
  getHoneypotByToken,
  markPatternEvent,
  recordHoneypotHit,
} from "@/lib/threats-core";
import { analyzeThreatHit } from "@/lib/threat-rules";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/threats-core", () => ({
  getHoneypotByToken: vi.fn(),
  recordHoneypotHit: vi.fn(),
  markPatternEvent: vi.fn(),
}));
vi.mock("@/lib/threat-rules", () => ({
  analyzeThreatHit: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: (fn: () => void | Promise<void>) => {
      void fn();
    },
  };
});

const getHoneypotMock = vi.mocked(getHoneypotByToken);
const recordHitMock = vi.mocked(recordHoneypotHit);
const analyzeMock = vi.mocked(analyzeThreatHit);
const markPatternMock = vi.mocked(markPatternEvent);

const HONEYPOT = {
  id: "00000000-0000-4000-8000-000000000001",
  site_id: "00000000-0000-4000-8000-000000000002",
  team_id: "00000000-0000-4000-8000-000000000003",
  token: "secret-token",
  enabled: true,
  hit_count: 10,
  created_at: new Date("2026-08-16T08:00:00Z"),
};

function getResponse(token: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new NextRequest(`http://localhost/h/${token}?x=1`, { headers });
  return GET(request, { params: Promise.resolve({ token }) });
}

describe("GET /h/[token]", () => {
  beforeEach(() => {
    getHoneypotMock.mockReset();
    recordHitMock.mockReset();
    analyzeMock.mockReset();
    markPatternMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("antwoordt altijd 404 (decoy) met no-index headers", async () => {
    getHoneypotMock.mockResolvedValue(null as never);
    const response = await getResponse("onbekend");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(recordHitMock).not.toHaveBeenCalled();
  });

  it("logt een hit + async analyse bij een actieve honeypot", async () => {
    getHoneypotMock.mockResolvedValue(HONEYPOT as never);
    recordHitMock.mockResolvedValue({
      eventId: "00000000-0000-4000-8000-000000000099",
    } as never);
    analyzeMock.mockResolvedValue({
      rule_key: "path_env",
      risk: "high",
    } as never);

    const response = await getResponse("secret-token", {
      "user-agent": "sqlmap/1.7",
      "x-forwarded-for": "203.0.113.10",
    });
    expect(response.status).toBe(404);

    expect(recordHitMock).toHaveBeenCalledWith(
      expect.anything(),
      HONEYPOT,
      expect.objectContaining({
        path: "/h/secret-token?x=1",
        ip: "203.0.113.10",
        userAgent: "sqlmap/1.7",
      }),
    );
    await vi.waitFor(() => {
      expect(markPatternMock).toHaveBeenCalledWith(
        expect.anything(),
        "00000000-0000-4000-8000-000000000099",
        { rule_key: "path_env", risk: "high" },
      );
    });
  });

  it("logt de hit zonder pattern-matching wanneer de analyse niets vindt", async () => {
    getHoneypotMock.mockResolvedValue(HONEYPOT as never);
    recordHitMock.mockResolvedValue({
      eventId: "00000000-0000-4000-8000-000000000099",
    } as never);
    analyzeMock.mockResolvedValue(null as never);

    const response = await getResponse("secret-token");
    expect(response.status).toBe(404);
    expect(recordHitMock).toHaveBeenCalled();
    expect(markPatternMock).not.toHaveBeenCalled();
  });

  it("logt niets bij een gededupliceerde hit", async () => {
    getHoneypotMock.mockResolvedValue(HONEYPOT as never);
    recordHitMock.mockResolvedValue({ eventId: null } as never);

    const response = await getResponse("secret-token");
    expect(response.status).toBe(404);
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("doet niets bij een uitgeschakelde honeypot", async () => {
    getHoneypotMock.mockResolvedValue({ ...HONEYPOT, enabled: false } as never);
    const response = await getResponse("secret-token");
    expect(response.status).toBe(404);
    expect(recordHitMock).not.toHaveBeenCalled();
  });
});
