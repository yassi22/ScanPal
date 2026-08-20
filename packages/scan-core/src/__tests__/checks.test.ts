import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { upsertChecks, type ScanCheckRow } from "../checks";

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rowCount: 0, rows: [] };
    },
  } as unknown as Pool;
  return { db, calls };
}

function row(over: Partial<ScanCheckRow> = {}): ScanCheckRow {
  return {
    scanId: "scan-1",
    checkId: "meta-tags",
    category: "seo",
    status: "pass",
    severity: "info",
    finding: { id: "x" },
    routeUrl: "https://example.com/",
    ...over,
  };
}

describe("upsertChecks (batched)", () => {
  it("doet geen query bij een lege lijst", async () => {
    const { db, calls } = fakeDb();
    await upsertChecks(db, []);
    expect(calls.length).toBe(0);
  });

  it("bundelt route-scoped findings in één multi-row insert", async () => {
    const { db, calls } = fakeDb();
    await upsertChecks(db, [
      row({ routeUrl: "https://example.com/" }),
      row({ routeUrl: "https://example.com/a" }),
      row({ routeUrl: "https://example.com/b" }),
    ]);
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("insert into checks");
    expect(calls[0].sql).toContain(
      "on conflict (scan_id, check_id, route_url) where route_url is not null",
    );
    // drie value-tuples, 7 params per rij
    expect(calls[0].params.length).toBe(21);
    expect(calls[0].params).toContain("https://example.com/a");
    expect(calls[0].params).toContain("https://example.com/b");
  });

  it("gebruikt de site-level conflict-target voor route_url = null", async () => {
    const { db, calls } = fakeDb();
    await upsertChecks(db, [row({ routeUrl: null, checkId: "repo-health" })]);
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain(
      "on conflict (scan_id, check_id) where route_url is null",
    );
  });

  it("dedupliceert dubbele conflict-sleutels binnen één batch (last-wins)", async () => {
    const { db, calls } = fakeDb();
    await upsertChecks(db, [
      row({ checkId: "meta-tags", routeUrl: "https://example.com/", status: "warn" }),
      row({ checkId: "meta-tags", routeUrl: "https://example.com/", status: "pass" }),
    ]);
    expect(calls.length).toBe(1);
    // één value-tuple (7 params), niet twee — anders faalt de ON CONFLICT
    expect(calls[0].params.length).toBe(7);
    // de laatste waarde wint
    expect(calls[0].params).toContain("pass");
    expect(calls[0].params).not.toContain("warn");
  });

  it("splitst gemengde rijen in twee inserts (route-scoped + site-level)", async () => {
    const { db, calls } = fakeDb();
    await upsertChecks(db, [
      row({ routeUrl: "https://example.com/" }),
      row({ routeUrl: null, checkId: "repo-health" }),
    ]);
    expect(calls.length).toBe(2);
  });
});
