import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/scans/[id]/findings/[findingId]/prompt/route";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

const queryMock = vi.mocked(pool.query);
const requireTeamMock = vi.mocked(requireTeam);

const SCAN_ID = "00000000-0000-4000-8000-000000000001";
const FINDING_ID = "https:https-ontbreekt";

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    check_id: "https",
    category: "http",
    severity: "high",
    title: "HTTPS ontbreekt",
    description: "Site is niet bereikbaar over HTTPS",
    remediation: "Regel een TLS-certificaat",
    evidence: null,
    status: "open",
    note: null,
    regressed: false,
    snooze_until: null,
    created_at: "2026-08-15T09:00:00.000Z",
    route_url: null,
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    findings: { v: 1, items: [makeItem()] },
    created_at: "2026-08-15T09:00:00.000Z",
    site_url: "example.com",
    site_label: "Example Site",
    github_repo: null,
    ...overrides,
  };
}

async function getResponse(): Promise<Response> {
  const request = new Request(
    `http://localhost/api/scans/${SCAN_ID}/findings/${encodeURIComponent(FINDING_ID)}/prompt`,
    { method: "GET" },
  );
  return GET(request as never, {
    params: Promise.resolve({ id: SCAN_ID, findingId: FINDING_ID }),
  });
}

describe("GET /api/scans/[id]/findings/[findingId]/prompt", () => {
  beforeEach(() => {
    queryMock.mockReset();
    requireTeamMock.mockReset();
    sessionTeam();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie en zonder key", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    expect((await getResponse()).status).toBe(401);
  });

  it("geeft 404 voor een scan die geen teamlid bezit", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    expect((await getResponse()).status).toBe(404);
  });

  it("geeft 404 voor een onbekende finding in deze scan", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeRow()],
    } as never);
    const request = new Request("http://localhost/prompt", { method: "GET" });
    const response = await GET(request as never, {
      params: Promise.resolve({ id: SCAN_ID, findingId: "niet:bestaat" }),
    });
    expect(response.status).toBe(404);
  });

  it("bouwt een prompt voor één finding met findings_covered = 1", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeRow()],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.findings_covered).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.prompt).toContain("# Fix prompt — Example Site");
    expect(body.prompt).toContain("HTTPS ontbreekt — High");
    expect(body.prompt).toContain("Regel een TLS-certificaat");
    expect(body.prompt).toContain("Provide the changes as a diff when done.");
  });

  it("verwijst bij een gekoppelde repo naar het bestandspad", async () => {
    const findingId = "semgrep:weak-hash";
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        makeRow({
          github_repo: "acme/web",
          findings: {
            v: 1,
            items: [
              makeItem({
                id: findingId,
                check_id: "semgrep",
                category: "github",
                title: "Weak hash",
                evidence: "src/auth.ts:22",
              }),
            ],
          },
        }),
      ],
    } as never);

    const request = new Request("http://localhost/prompt", { method: "GET" });
    const response = await GET(request as never, {
      params: Promise.resolve({ id: SCAN_ID, findingId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prompt).toContain(
      "File: https://github.com/acme/web/blob/main/src/auth.ts",
    );
  });
});