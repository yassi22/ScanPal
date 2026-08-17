import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/scans/route";
import { requireTeam } from "@/lib/api-auth";
import { getPlanForTeam } from "@/lib/credits";
import { createManualScan } from "@/lib/scans-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: {},
}));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
}));
vi.mock("@/lib/credits", () => ({
  getPlanForTeam: vi.fn(),
  CreditLimitError: class extends Error {},
}));
vi.mock("@/lib/scans-core", () => ({
  createManualScan: vi.fn(),
  emitScanFinishedNotifications: vi.fn(),
  listScanHistory: vi.fn(),
  ScanError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  toScanJson: vi.fn(
    (scan: {
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
}));
vi.mock("@/lib/scan-queue", () => ({
  enqueueScan: vi.fn().mockResolvedValue(undefined),
}));

const requireTeamMock = vi.mocked(requireTeam);
const getPlanForTeamMock = vi.mocked(getPlanForTeam);
const createManualScanMock = vi.mocked(createManualScan);
import { enqueueScan } from "@/lib/scan-queue";
const enqueueScanMock = vi.mocked(enqueueScan);

const SITE_ID = "00000000-0000-4000-8000-000000000002";
const SCAN_ID = "00000000-0000-4000-8000-000000000001";

function scanRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", auth: { type: "session", userId: "user-1" } },
  } as never);
  createManualScanMock.mockResolvedValue({
    scan: {
      id: SCAN_ID,
      site_id: SITE_ID,
      status: "running",
      progress: 0,
      progress_details: {
        categories: {
          http: { status: "pending", done: 0, total: 4, percent: 0, current_check: null },
          seo: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
          aeo: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
          github: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
        },
        checks_done: 0,
        checks_total: 4,
        updated_at: new Date().toISOString(),
      },
      score: null,
      findings: {},
      active_tests: false,
      trigger: "manual",
      scheduled_for: null,
      created_at: new Date(),
      completed_at: null,
    },
    completed: false,
  } as never);
});

describe("POST /api/scans (plan 52)", () => {
  it("weigert active_tests op een Free-plan met 403 + upsell", async () => {
    getPlanForTeamMock.mockResolvedValue({
      id: "free",
      features: { activeTests: false },
    } as never);

    const res = await POST(scanRequest({ site_id: SITE_ID, active_tests: true }));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data).toEqual({
      error: expect.any(String),
      upsell: { plan: "pro" },
      feature: "active_tests",
    });
    expect(createManualScanMock).not.toHaveBeenCalled();
  });

  it("laat active_tests door voor een Pro-plan (202 + enqueue)", async () => {
    getPlanForTeamMock.mockResolvedValue({
      id: "pro",
      features: { activeTests: true },
    } as never);

    const res = await POST(scanRequest({ site_id: SITE_ID, active_tests: true }));

    expect(res.status).toBe(202);
    expect(createManualScanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ activeTests: true }),
    );
    expect(enqueueScanMock).toHaveBeenCalledWith(SCAN_ID);
  });

  it("gaat door met actieve tests uit (default false) op Pro", async () => {
    getPlanForTeamMock.mockResolvedValue({
      id: "pro",
      features: { activeTests: true },
    } as never);

    await POST(scanRequest({ site_id: SITE_ID }));

    expect(createManualScanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ activeTests: false }),
    );
    expect(enqueueScanMock).toHaveBeenCalledWith(SCAN_ID);
  });
});