import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool } from "pg";
import { createAggregateProcessor } from "../aggregate";

vi.mock("@scanpal/scan-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scanpal/scan-core")>();
  return {
    ...actual,
    finishScan: vi.fn(),
    emitScanFinishedNotifications: vi.fn(),
  };
});

import { finishScan, emitScanFinishedNotifications } from "@scanpal/scan-core";
const mockedFinish = vi.mocked(finishScan);
const mockedEmit = vi.mocked(emitScanFinishedNotifications);

const CHECK_ROWS = [
  {
    check_id: "https",
    category: "http",
    status: "fail",
    severity: "high",
    finding: {
      id: "https:https-ontbreekt",
      check_id: "https",
      category: "http",
      severity: "high",
      title: "HTTPS ontbreekt",
      description: "",
      remediation: "",
      evidence: null,
      active: false,
      status: "open",
      note: null,
      created_at: "2026-08-17T10:00:00.000Z",
    },
  },
];

function fakeDb(scan: Record<string, unknown> | null, checks: unknown[] = []) {
  const db = {
    query: async (sql: string, _params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("select sc.site_id")) {
        return scan ? { rowCount: 1, rows: [scan] } : { rowCount: 0, rows: [] };
      }
      if (text.startsWith("select check_id, category, status, severity, finding")) {
        return { rowCount: checks.length, rows: checks };
      }
      if (text.startsWith("select score from scans")) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Onverwachte query in aggregate-test: ${text}`);
    },
  } as unknown as Pool;
  return { db };
}

const notify = vi.fn().mockResolvedValue(undefined);

describe("createAggregateProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bouwt findings uit checks, finaliseert completed en emitt notificaties", async () => {
    const scan = { site_id: "site-1", team_id: "team-1", url: "example.com", label: null };
    const { db } = fakeDb(scan, CHECK_ROWS);
    mockedFinish.mockResolvedValue({
      id: "scan-1",
      status: "completed",
      score: 25,
      findings: { v: 1, items: CHECK_ROWS.map((r) => r.finding) },
    } as never);

    const processor = createAggregateProcessor(db, notify, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(mockedFinish).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        scanId: "scan-1",
        status: "completed",
        // één high-finding → overall-score 0 (pass-ratio), http-categorie 0.
        score: 0,
        categoryScores: expect.objectContaining({ http: 0 }),
      }),
    );
    expect(mockedEmit).toHaveBeenCalled();
  });

  it("stuurt een score_drop-notificatie bij een daling", async () => {
    const scan = { site_id: "site-1", team_id: "team-1", url: "example.com", label: null };
    const { db } = fakeDb(scan, CHECK_ROWS);
    mockedFinish.mockResolvedValue({
      id: "scan-1",
      status: "completed",
      score: 25,
      findings: { v: 1, items: [] },
    } as never);

    const dbWithPrev = {
      query: async (sql: string, _params: unknown[] = []) => {
        const text = sql.replace(/\s+/g, " ").trim();
        if (text.startsWith("select sc.site_id")) {
          return { rowCount: 1, rows: [scan] };
        }
        if (text.startsWith("select check_id")) {
          return { rowCount: CHECK_ROWS.length, rows: CHECK_ROWS };
        }
        if (text.startsWith("select score from scans")) {
          return { rowCount: 1, rows: [{ score: 80 }] };
        }
        throw new Error(`Onverwachte query in aggregate-test: ${text}`);
      },
    } as unknown as Pool;

    const processor = createAggregateProcessor(dbWithPrev, notify, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "score_drop",
        payload: expect.objectContaining({ previous_score: 80, new_score: 25 }),
      }),
    );
  });

  it("stopt na finishScan als de scan is gecanceld (geen notificaties)", async () => {
    const scan = { site_id: "site-1", team_id: "team-1", url: "example.com", label: null };
    const { db } = fakeDb(scan, CHECK_ROWS);
    mockedFinish.mockResolvedValue({ id: "scan-1", status: "canceled", score: null } as never);

    const processor = createAggregateProcessor(db, notify, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(mockedEmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});