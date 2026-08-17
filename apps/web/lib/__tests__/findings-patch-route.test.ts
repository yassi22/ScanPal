import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/scans/[id]/findings/[findingId]/route";
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
    created_at: "2026-08-15T09:00:00.000Z",
    ...overrides,
  };
}

function makePayload(items: unknown[] = [makeItem()]) {
  return { v: 1, items };
}

async function patchResponse(body: unknown): Promise<Response> {
  const request = new Request(
    `http://localhost/api/scans/${SCAN_ID}/findings/${encodeURIComponent(FINDING_ID)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return PATCH(request, {
    params: Promise.resolve({ id: SCAN_ID, findingId: FINDING_ID }),
  });
}

describe("PATCH /api/scans/[id]/findings/[findingId]", () => {
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
    const response = await patchResponse({ status: "fixed" });
    expect(response.status).toBe(401);
  });

  it("geeft 404 voor een scan die geen teamlid bezit", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await patchResponse({ status: "fixed" });
    expect(response.status).toBe(404);
  });

  it("geeft 404 bij legacy-data zonder v1-payload", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ findings: { checks: [] } }],
    } as never);
    expect((await patchResponse({ status: "fixed" })).status).toBe(404);
  });

  it("geeft 404 bij een onbekende finding-id in deze scan", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ findings: makePayload([makeItem({ id: "a:anders" })]) }],
    } as never);
    expect((await patchResponse({ status: "fixed" })).status).toBe(404);
  });

  it("geeft 400 bij een ongeldige body", async () => {
    const response = await patchResponse({ status: "opgelost" });
    expect(response.status).toBe(400);
  });

  it("zet de status (+ note) en slaat het payload op in de scans-rij", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ findings: makePayload([makeItem()]) }],
    } as never);
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);

    const response = await patchResponse({
      status: "ignored",
      note: "bewuste keuze",
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ignored");
    expect(body.note).toBe("bewuste keuze");

    const updateCall = queryMock.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].startsWith("update scans"),
    );
    expect(updateCall).toBeDefined();
    const stored = JSON.parse(updateCall![1][0] as string);
    expect(stored).toMatchObject({
      v: 1,
      items: [{ id: FINDING_ID, status: "ignored", note: "bewuste keuze" }],
    });
  });

  it("maakt de note leeg bij een status-wijziging zonder note", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          findings: makePayload([
            makeItem({ status: "ignored", note: "oude reden" }),
          ]),
        },
      ],
    } as never);
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);

    const response = await patchResponse({ status: "open" });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("open");
    expect(body.note).toBeNull();
  });
});
