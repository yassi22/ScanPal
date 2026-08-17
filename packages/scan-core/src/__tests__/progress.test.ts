import { describe, it, expect } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { initialProgressDetails } from "@scanpal/shared";
import { advanceCategoryProgress } from "../progress";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function fakeClient(router: (sql: string, params: unknown[]) => QueryResultLike) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return router(sql, params);
    },
    release: () => {},
  } as unknown as PoolClient;
  return { client, calls };
}

const norm = (sql: string) => sql.replace(/\s+/g, " ");

describe("advanceCategoryProgress (atomic, queue-modus)", () => {
  it("schuift een categorie op en eindigt op 100", async () => {
    const details = initialProgressDetails({ http: 1 }, "2026-08-17T09:00:00.000Z");

    const { client, calls } = fakeClient((sql) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "begin" || text === "commit") return { rowCount: 1, rows: [] };
      if (text.startsWith("select progress_details")) {
        return { rowCount: 1, rows: [{ progress_details: details }] };
      }
      if (text.startsWith("update scans set progress")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Onverwachte query in progress-test: ${text}`);
    });

    const db = { connect: async () => client } as unknown as Pool;

    await advanceCategoryProgress(
      db,
      "scan-1",
      "http",
      "https",
      "2026-08-17T09:00:01.000Z",
    );

    const norm2 = norm;
    const update = calls.find((c) => norm2(c.sql).includes("update scans set progress"));
    expect(update).toBeDefined();
    expect(update!.params[1]).toBe(100);
    const stored = JSON.parse(update!.params[2] as string);
    expect(stored.categories.http).toMatchObject({
      status: "done",
      done: 1,
      total: 1,
      percent: 100,
    });
    expect(stored.checks_done).toBe(1);
  });

  it("is een no-op voor onbekende check-ids (geen update)", async () => {
    const details = initialProgressDetails({ http: 3 }, "2026-08-17T09:00:00.000Z");

    const { client, calls } = fakeClient((sql) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "begin" || text === "commit") return { rowCount: 1, rows: [] };
      if (text.startsWith("select progress_details")) {
        return { rowCount: 1, rows: [{ progress_details: details }] };
      }
      throw new Error(`Onverwachte query in progress-test: ${text}`);
    });

    const db = { connect: async () => client } as unknown as Pool;

    await advanceCategoryProgress(
      db,
      "scan-1",
      "http",
      "bestaande-niet",
      "2026-08-17T09:00:01.000Z",
    );

    expect(
      calls.filter((c) => norm(c.sql).includes("update scans set progress")),
    ).toHaveLength(0);
  });

  it("doet niets als de scan ontbreekt", async () => {
    const { client, calls } = fakeClient((sql) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "begin" || text === "rollback") return { rowCount: 1, rows: [] };
      if (text.startsWith("select progress_details")) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Onverwachte query in progress-test: ${text}`);
    });

    const db = { connect: async () => client } as unknown as Pool;

    await advanceCategoryProgress(
      db,
      "scan-404",
      "http",
      "https",
      "2026-08-17T09:00:01.000Z",
    );

    expect(calls.filter((c) => norm(c.sql).includes("update scans"))).toHaveLength(0);
  });
});