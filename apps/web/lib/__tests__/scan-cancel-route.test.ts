import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/scans/[id]/cancel/route";
import { requireTeam } from "@/lib/api-auth";
import { cancelScan, CancelScanError } from "@/lib/scans-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: {},
}));
vi.mock("@/lib/scans-core", () => ({
  cancelScan: vi.fn(),
  toScanJson: vi.fn(
    (scan: {
      id: string;
      status: string;
      scheduled_for: Date | null;
      created_at: Date;
      completed_at: Date | null;
    }) => ({
      ...scan,
      scheduled_for: scan.scheduled_for
        ? new Date(scan.scheduled_for).toISOString()
        : null,
      created_at: new Date(scan.created_at).toISOString(),
      completed_at: scan.completed_at
        ? new Date(scan.completed_at).toISOString()
        : null,
    }),
  ),
  CancelScanError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const requireTeamMock = vi.mocked(requireTeam);
const cancelMock = vi.mocked(cancelScan);

const SCAN_ID = "00000000-0000-4000-8000-000000000001";
const SITE_ID = "00000000-0000-4000-8000-000000000002";

function sessionTeam() {
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
}

function cancelRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/scans/${SCAN_ID}/cancel`, {
    method: "POST",
  });
}

function makeScan(status = "canceled") {
  return {
    id: SCAN_ID,
    site_id: SITE_ID,
    status,
    progress: 0,
    progress_details: {
      categories: {
        http: {
          status: "pending",
          done: 0,
          total: 0,
          percent: 0,
          current_check: null,
        },
        seo: {
          status: "pending",
          done: 0,
          total: 0,
          percent: 0,
          current_check: null,
        },
        aeo: {
          status: "pending",
          done: 0,
          total: 0,
          percent: 0,
          current_check: null,
        },
        github: {
          status: "pending",
          done: 0,
          total: 0,
          percent: 0,
          current_check: null,
        },
      },
      checks_done: 0,
      checks_total: 0,
      updated_at: "2026-08-16T09:00:00.000Z",
    },
    score: null,
    findings: {},
    trigger: "manual",
    scheduled_for: null,
    created_at: new Date("2026-08-16T09:00:00Z"),
    completed_at: null,
  };
}

describe("POST /api/scans/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionTeam();
    cancelMock.mockResolvedValue(makeScan() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie en zonder key", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(401);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("geeft 429 met Retry-After bij rate limiting", async () => {
    requireTeamMock.mockResolvedValue({
      ok: false,
      status: 429,
      retryAfter: 30,
    } as never);
    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("cancelt een queued/running scan en retourneert de scan (200)", async () => {
    const canceled = makeScan();
    cancelMock.mockResolvedValue(canceled as never);

    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(200);

    expect(cancelMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      scanId: SCAN_ID,
    });

    const body = await response.json();
    expect(body.scan.id).toBe(SCAN_ID);
    expect(body.scan.status).toBe("canceled");
  });

  it("geeft 409 voor een terminale scan", async () => {
    const err = new CancelScanError(
      "not_cancelable",
      "Scan is al afgerond",
    ) as never;
    cancelMock.mockRejectedValue(err);

    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("Scan is al afgerond");
  });

  it("geeft 404 voor een scan die geen teamlid bezit", async () => {
    const err = new CancelScanError("not_found", "Scan niet gevonden") as never;
    cancelMock.mockRejectedValue(err);

    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(404);
  });

  it("geeft 500 bij een onverwachte fout", async () => {
    cancelMock.mockRejectedValue(new Error("database kapot"));

    const response = await POST(cancelRequest(), {
      params: Promise.resolve({ id: SCAN_ID }),
    });
    expect(response.status).toBe(500);
  });
});