import { describe, it, expect, vi } from "vitest";
import type { PoolClient, QueryResult } from "pg";
import type { FindingsPayload } from "@scanpal/shared";
import { carryOverFindingStatuses } from "../finding-status";

vi.mock("server-only", () => ({}));

function makeItem(overrides: Partial<FindingsPayload["items"][number]> = {}) {
  return {
    id: "https:https-ontbreekt",
    check_id: "https",
    category: "http",
    severity: "high",
    title: "HTTPS ontbreekt",
    description: "",
    remediation: "",
    evidence: null,
    status: "open",
    note: null,
    created_at: "2026-08-15T09:00:00.000Z",
    ...overrides,
  };
}

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function fakeClient(previousFindings: Record<string, unknown> | null) {
  const queries: { text: string; params: unknown[] }[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []): Promise<QueryResultLike> => {
      queries.push({ text, params });
      if (previousFindings === null) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ findings: previousFindings }] };
    },
  } as unknown as PoolClient;
  return { client, queries };
}

describe("carryOverFindingStatuses", () => {
  it("past carry-over toe op een v1-payload met een vorige scan", async () => {
    const previous = {
      v: 1,
      items: [
        makeItem({ status: "ignored", note: "bewuste keuze" }),
        makeItem({ id: "x:anders", status: "fixed" }),
      ],
    };
    const { client } = fakeClient(previous);

    const result = await carryOverFindingStatuses(client, {
      scanId: "scan-2",
      siteId: "site-1",
      findings: {
        v: 1,
        items: [makeItem({ status: "open", note: null })],
      },
    });

    expect(result).toMatchObject({
      v: 1,
      items: [{ id: "https:https-ontbreekt", status: "ignored", note: "bewuste keuze" }],
    });
  });

  it("laat een v1-payload onveranderd zonder vorige scan", async () => {
    const { client, queries } = fakeClient(null);
    const findings = { v: 1, items: [makeItem()] };

    const result = await carryOverFindingStatuses(client, {
      scanId: "scan-1",
      siteId: "site-1",
      findings,
    });

    expect(result).toEqual(findings);
    expect(queries[0].params).toEqual(["site-1", "scan-1"]);
  });

  it("laat niet-payload-findings (bijv. { error }) onveranderd door", async () => {
    const { client } = fakeClient({ v: 1, items: [makeItem({ status: "fixed" })] });
    const findings = { error: "netwerkfout" };

    const result = await carryOverFindingStatuses(client, {
      scanId: "scan-2",
      siteId: "site-1",
      findings,
    });

    expect(result).toEqual(findings);
  });

  it("is een no-op als de vorige scan legacy-data bevat", async () => {
    const { client } = fakeClient({ checks: [] });
    const findings = { v: 1, items: [makeItem()] };

    const result = await carryOverFindingStatuses(client, {
      scanId: "scan-2",
      siteId: "site-1",
      findings,
    });

    expect(result).toEqual(findings);
  });
});
