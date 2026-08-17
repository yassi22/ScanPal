import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/scans/[id]/stream/route";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

const queryMock = vi.mocked(pool.query);
const getUserMock = vi.mocked(getSessionUser);

const USER = { id: "user-1" };
const SCAN_ID = "00000000-0000-4000-8000-000000000001";

function makeRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "running",
    progress: 25,
    progress_details: {
      categories: {
        http: {
          status: "running",
          done: 1,
          total: 3,
          percent: 33,
          current_check: "HTTPS",
        },
        seo: { status: "pending", done: 0, total: 1, percent: 0, current_check: null },
        aeo: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
        github: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
      },
      checks_done: 1,
      checks_total: 4,
      updated_at: "2026-08-15T09:00:00.000Z",
    },
    score: null,
    findings: {},
    ...overrides,
  };
}

async function getResponse(signal?: AbortSignal): Promise<Response> {
  const request = new NextRequest(
    `http://localhost/api/scans/${SCAN_ID}/stream`,
    signal ? { signal } : undefined,
  );
  return GET(request, { params: Promise.resolve({ id: SCAN_ID }) });
}

describe("GET /api/scans/[id]/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await getResponse();
    expect(response.status).toBe(401);
  });

  it("geeft 404 voor een scan die geen teamlid bezit (authz via join)", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await getResponse();
    expect(response.status).toBe(404);
  });

  it("heeft de SSE-headers", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow()] } as never);
    const response = await getResponse();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    response.body?.cancel();
  });

  it("streamt progress-events en sluit na het completed-event", async () => {
    const row = makeRow();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [row] } as never);

    const response = await getResponse();
    const reader = response.body!.getReader();

    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: progress");
    expect(first).toContain('"overall":25');
    expect(first).toContain('"checks_total":4');

    row.status = "completed";
    row.score = 83;
    row.findings = {
      v: 1,
      items: [
        {
          id: "a:high",
          check_id: "a",
          category: "http",
          severity: "high",
          title: "A",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
        {
          id: "b:info",
          check_id: "b",
          category: "http",
          severity: "info",
          title: "B",
          description: "",
          remediation: "",
          evidence: null,
          status: "open",
          note: null,
          created_at: "2026-08-15T09:00:00.000Z",
        },
      ],
    };

    await vi.advanceTimersByTimeAsync(2000);
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain("event: completed");
    expect(second).toContain('"score":83');
    expect(second).toContain('"high":1');
    expect(second).toContain('"info":1');

    await vi.advanceTimersByTimeAsync(2000);
    const closed = await reader.read();
    expect(closed.done).toBe(true);
  });

  it("stuurt een failed-event met de foutmelding", async () => {
    const row = makeRow({ status: "failed", findings: { error: "netwerkfout" } });
    queryMock.mockResolvedValue({ rowCount: 1, rows: [row] } as never);

    const response = await getResponse();
    const reader = response.body!.getReader();

    await vi.advanceTimersByTimeAsync(2000);
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("event: failed");
    expect(frame).toContain('"error":"netwerkfout"');
  });

  it("stuurt een canceled-event en sluit de stream", async () => {
    const row = makeRow();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [row] } as never);

    const response = await getResponse();
    const reader = response.body!.getReader();

    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: progress");

    row.status = "canceled";
    await vi.advanceTimersByTimeAsync(2000);
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("event: canceled");
    expect(frame).toContain('"status":"canceled"');

    await vi.advanceTimersByTimeAsync(2000);
    const closed = await reader.read();
    expect(closed.done).toBe(true);
  });

  it("stuurt een heartbeat :ping en houdt de verbinding open", async () => {
    const row = makeRow();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [row] } as never);

    const response = await getResponse();
    const reader = response.body!.getReader();

    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: progress");

    await vi.advanceTimersByTimeAsync(16000);
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain(": ping");
  });

  it("stopt netjes als de client weg is (abort)", async () => {
    const row = makeRow();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [row] } as never);

    const controller = new AbortController();
    const response = await getResponse(controller.signal);
    const reader = response.body!.getReader();

    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: progress");

    controller.abort();
    await vi.advanceTimersByTimeAsync(2000);
    const closed = await reader.read();
    expect(closed.done).toBe(true);
  });

  it("sluit na maximaal ~5 minuten", async () => {
    const row = makeRow();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [row] } as never);

    const response = await getResponse();
    const reader = response.body!.getReader();

    await vi.advanceTimersByTimeAsync(302000);
    let sawClosed = false;
    for (let i = 0; i < 200; i++) {
      const { done } = await reader.read();
      if (done) {
        sawClosed = true;
        break;
      }
    }
    expect(sawClosed).toBe(true);
  });
});
