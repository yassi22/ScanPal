import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/scans/[id]/fix-prompt/route";
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

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "https:https-ontbreekt",
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
  const request = new Request(`http://localhost/api/scans/${SCAN_ID}/fix-prompt`, {
    method: "GET",
  });
  return GET(request as never, { params: Promise.resolve({ id: SCAN_ID }) });
}

describe("GET /api/scans/[id]/fix-prompt", () => {
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

  it("groepeert open findings en sluit fixed/ignored uit", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        makeRow({
          findings: {
            v: 1,
            items: [
              makeItem({ id: "a:open", title: "Open A", severity: "critical" }),
              makeItem({ id: "b:fixed", title: "Opgelost", status: "fixed" }),
              makeItem({ id: "c:ignored", title: "Genegeerd", status: "ignored" }),
            ],
          },
        }),
      ],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.findings_covered).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.prompt).toContain("Open A (Critical)");
    expect(body.prompt).not.toContain("Opgelost");
    expect(body.prompt).not.toContain("Genegeerd");
    expect(body.prompt).toContain("Provide the changes as a diff when done.");
  });

  it("levert een geldige lege prompt voor een scan zonder v1-payload", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeRow({ findings: { checks: [] } })],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.findings_covered).toBe(0);
    expect(body.truncated).toBe(false);
    expect(typeof body.prompt).toBe("string");
  });

  it("verwijst bij een gekoppelde repo naar github.com-bestandspaden", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        makeRow({
          github_repo: "acme/web",
          findings: {
            v: 1,
            items: [
              makeItem({
                id: "g:leak",
                check_id: "gitleaks",
                category: "github",
                title: "Leak",
                evidence: "src/config.js:7",
              }),
            ],
          },
        }),
      ],
    } as never);

    const response = await getResponse();
    const body = await response.json();
    expect(body.prompt).toContain(
      "File: https://github.com/acme/web/blob/main/src/config.js",
    );
  });
});