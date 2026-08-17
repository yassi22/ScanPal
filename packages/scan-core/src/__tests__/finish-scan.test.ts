import { describe, it, expect, beforeEach } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { finishScan } from "../finish-scan";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type RecordedQuery = { sql: string; params: unknown[] };

function fakeClient(router: (sql: string, params: unknown[]) => QueryResultLike) {
  const calls: RecordedQuery[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return router(sql, params);
    },
    release: () => {},
  } as unknown as PoolClient;
  return { client, calls };
}

describe("finishScan (race-guard + category_scores)", () => {
  it("finaliseert een scan met scores en werkt de site-status bij", async () => {
    const scanRow = {
      id: "scan-1",
      status: "completed",
      score: 80,
      category_scores: { http: 90, seo: 70 },
    };

    const { client, calls } = fakeClient((sql, params) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "begin" || text === "commit") return { rowCount: 1, rows: [] };
      if (text.startsWith("select status from scans")) {
        return { rowCount: 1, rows: [{ status: "running" }] };
      }
      if (text.startsWith("select findings from scans")) {
        return { rowCount: 0, rows: [] };
      }
      if (text.startsWith("update scans set status")) {
        return { rowCount: 1, rows: [scanRow] };
      }
      if (text.startsWith("update sites set last_scan_id")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Onverwachte query in finishScan-test: ${text}`);
    });

    const db = { connect: async () => client } as unknown as Pool;

    const result = await finishScan(db, {
      scanId: "scan-1",
      siteId: "site-1",
      status: "completed",
      score: 80,
      findings: { v: 1, items: [] },
      categoryScores: { http: 90, seo: 70 },
    });

    expect(result).toMatchObject({ status: "completed", score: 80 });
    const norm = (sql: string) => sql.replace(/\s+/g, " ");
    const update = calls.find((c) => norm(c.sql).includes("update scans set status"));
    expect(update).toBeDefined();
    expect(update!.params[4]).toBe('{"http":90,"seo":70}');
    const siteUpdate = calls.find((c) => norm(c.sql).includes("update sites"));
    expect(siteUpdate).toBeDefined();
    expect(siteUpdate!.params).toEqual(["scan-1", "completed", 80, "site-1"]);
  });

  it("overschrijft een gecancelde scan nooit (race-guard)", async () => {
    const { client } = fakeClient((sql, params) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "begin" || text === "commit") return { rowCount: 1, rows: [] };
      if (text.startsWith("select status from scans")) {
        return { rowCount: 1, rows: [{ status: "canceled" }] };
      }
      if (text.startsWith("select * from scans")) {
        return { rowCount: 1, rows: [{ id: "scan-1", status: "canceled" }] };
      }
      throw new Error(`Onverwachte query in finishScan-test: ${text}`);
    });

    const db = { connect: async () => client } as unknown as Pool;

    const result = await finishScan(db, {
      scanId: "scan-1",
      siteId: "site-1",
      status: "completed",
      score: 99,
      categoryScores: { http: 99 },
    });

    expect(result).toMatchObject({ status: "canceled" });
  });
});