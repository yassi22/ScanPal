import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { setRouteHttpStatuses } from "../routes";

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

describe("setRouteHttpStatuses (batched)", () => {
  it("doet geen query bij een lege lijst", async () => {
    const { db, calls } = fakeDb();
    await setRouteHttpStatuses(db, "scan-1", []);
    expect(calls.length).toBe(0);
  });

  it("werkt meerdere route-statussen in één update bij", async () => {
    const { db, calls } = fakeDb();
    await setRouteHttpStatuses(db, "scan-1", [
      { url: "https://example.com/", status: 200 },
      { url: "https://example.com/a", status: 404 },
    ]);
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("update scan_routes set http_status");
    expect(calls[0].sql).toContain("from (values");
    expect(calls[0].params).toEqual([
      "scan-1",
      "https://example.com/",
      200,
      "https://example.com/a",
      404,
    ]);
  });
});
