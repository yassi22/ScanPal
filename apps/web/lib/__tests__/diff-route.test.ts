import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/scans/[id]/diff/route";
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

function makePayload(items: unknown[] = []) {
  return { v: 1, items };
}

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function makeDiff(overrides: Record<string, unknown> = {}) {
  return {
    new: emptyCounts(),
    resolved: emptyCounts(),
    regressed: emptyCounts(),
    unchanged: emptyCounts(),
    new_finding_ids: [],
    regressed_finding_ids: [],
    alert_new: emptyCounts(),
    alert_regressed: emptyCounts(),
    ...overrides,
  };
}

async function getResponse(): Promise<Response> {
  const request = new Request(
    `http://localhost/api/scans/${SCAN_ID}/diff`,
    { method: "GET" },
  );
  return GET(request as never, {
    params: Promise.resolve({ id: SCAN_ID }),
  });
}

describe("GET /api/scans/[id]/diff", () => {
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

  it("geeft een lege diff voor scans zonder diff-veld", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ diff: {}, findings: makePayload([makeItem()]) }],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.diff.new_finding_ids).toEqual([]);
    expect(body.findings).toEqual([]);
  });

  it("retourneert diff + de geselecteerde (nieuwe + teruggekeerde) findings", async () => {
    const newFinding = makeItem({
      id: "headers:x-frame-options",
      title: "X-Frame-Options ontbreekt",
      severity: "medium",
    });
    const regressedFinding = makeItem({
      id: "seo:title",
      title: "Geen title-tag",
      severity: "low",
      regressed: true,
    });
    const unchangedFinding = makeItem({
      id: "https:https-ontbreekt",
      title: "HTTPS ontbreekt",
    });

    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          diff: makeDiff({
            new: { ...emptyCounts(), medium: 1 },
            regressed: { ...emptyCounts(), low: 1 },
            unchanged: { ...emptyCounts(), high: 1 },
            new_finding_ids: [newFinding.id],
            regressed_finding_ids: [regressedFinding.id],
          }),
          findings: makePayload([
            newFinding,
            regressedFinding,
            unchangedFinding,
          ]),
        },
      ],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.diff.new.medium).toBe(1);
    expect(body.findings.map((finding: { id: string }) => finding.id).sort()).toEqual(
      [newFinding.id, regressedFinding.id].sort(),
    );
  });

  it("geeft lege findings als het payload niet v1 is, zonder te crashen", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          diff: makeDiff({ new_finding_ids: ["x:y"] }),
          findings: { checks: [] },
        },
      ],
    } as never);

    const response = await getResponse();
    expect(response.status).toBe(200);
    expect((await response.json()).findings).toEqual([]);
  });
});