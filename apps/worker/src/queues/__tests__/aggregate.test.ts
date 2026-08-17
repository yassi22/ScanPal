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

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function makeDiff(overrides: Partial<Record<string, unknown>> = {}) {
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
      trigger: "schedule",
      score: 25,
      diff: makeDiff(),
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

  it("stuurt een scan_diff-alert bij nieuwe bevindingen vanaf medium", async () => {
    const scan = { site_id: "site-1", team_id: "team-1", url: "example.com", label: null };
    const { db } = fakeDb(scan, CHECK_ROWS);
    mockedFinish.mockResolvedValue({
      id: "scan-1",
      status: "completed",
      trigger: "schedule",
      score: 25,
      diff: makeDiff({
        new: { ...emptyCounts(), high: 1 },
        new_finding_ids: ["a:nieuw"],
        alert_new: { ...emptyCounts(), high: 1 },
      }),
      findings: { v: 1, items: [] },
    } as never);

    const processor = createAggregateProcessor(db, notify, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "scan_diff",
        entityId: "scan-1",
        payload: expect.objectContaining({ new_count: 1, site_name: "example.com" }),
      }),
    );
  });

  it("stuurt geen diff-alert voor handmatige scans", async () => {
    const scan = { site_id: "site-1", team_id: "team-1", url: "example.com", label: null };
    const { db } = fakeDb(scan, CHECK_ROWS);
    mockedFinish.mockResolvedValue({
      id: "scan-1",
      status: "completed",
      trigger: "manual",
      score: 25,
      diff: makeDiff({
        new: { ...emptyCounts(), critical: 1 },
        alert_new: { ...emptyCounts(), critical: 1 },
      }),
      findings: { v: 1, items: [] },
    } as never);

    const processor = createAggregateProcessor(db, notify, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "scan_diff" }),
    );
  });

  it("stuurt geen diff-alert onder de drempel (alleen low/new of gesnoozd)", async () => {
    const scan = { site_id: "site-1", team_id: "team-1", url: "example.com", label: null };
    const { db } = fakeDb(scan, CHECK_ROWS);
    mockedFinish.mockResolvedValue({
      id: "scan-1",
      status: "completed",
      trigger: "schedule",
      score: 25,
      diff: makeDiff({
        new: { ...emptyCounts(), low: 2 },
        new_finding_ids: ["a:laag"],
        alert_new: { ...emptyCounts() },
      }),
      findings: { v: 1, items: [] },
    } as never);

    const processor = createAggregateProcessor(db, notify, () => {});
    await processor({ data: { scanId: "scan-1" } });

    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "scan_diff" }),
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