import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool, QueryResult } from "pg";
import { emitScanFinishedNotifications } from "../scans-core";
import type { ScanNotificationSender } from "../scans-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({ notifier: vi.fn() }));
vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function fakePool(site: { url: string; label: string | null } | null) {
  const db = {
    query: async (sql: string): Promise<QueryResultLike> => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("select url, label from sites")) {
        return site ? { rowCount: 1, rows: [{ ...site }] } : { rowCount: 0, rows: [] };
      }
      throw new Error(`onbekende query in test-fake: ${text}`);
    },
  };
  return db as unknown as Pool;
}

function sendSpy() {
  return vi.fn() as ScanNotificationSender & ReturnType<typeof vi.fn>;
}

const BASE = {
  teamId: "team-1",
  siteId: "site-1",
  scanId: "scan-1",
  score: 72,
};

describe("emitScanFinishedNotifications", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stuurt scan_done altijd en critical_finding alleen bij kritieke bevindingen", async () => {
    const send = sendSpy();
    await emitScanFinishedNotifications(
      fakePool({ url: "https://voorbeeld.nl", label: "Voorbeeld" }),
      {
        ...BASE,
        findings: {
          v: 1,
          items: [
            {
              id: "a:1",
              check_id: "https",
              category: "http",
              severity: "critical",
              title: "Kritiek",
              description: "",
              remediation: "",
              evidence: null,
              status: "open",
              note: null,
              created_at: "2026-08-16T09:00:00.000Z",
            },
          ],
        },
      },
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, {
      type: "scan_done",
      teamId: "team-1",
      entityId: "scan-1",
      payload: { site_name: "Voorbeeld", score: 72 },
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "critical_finding",
      teamId: "team-1",
      entityId: "scan-1",
      payload: { site_name: "Voorbeeld", count: 1 },
    });
  });

  it("stuurt alleen scan_done zonder kritieke bevindingen", async () => {
    const send = sendSpy();
    await emitScanFinishedNotifications(
      fakePool({ url: "https://voorbeeld.nl", label: null }),
      {
        ...BASE,
        findings: { v: 1, items: [] },
      },
      send,
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: "scan_done",
      teamId: "team-1",
      entityId: "scan-1",
      payload: { site_name: "https://voorbeeld.nl", score: 72 },
    });
  });

  it("doet niets als de site niet bestaat", async () => {
    const send = sendSpy();
    await emitScanFinishedNotifications(
      fakePool(null),
      { ...BASE, findings: { v: 1, items: [] } },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("een mislukte send breekt de route niet", async () => {
    const send = vi.fn().mockRejectedValue(new Error("hub kapot"));
    await expect(
      emitScanFinishedNotifications(
        fakePool({ url: "https://voorbeeld.nl", label: null }),
        { ...BASE, findings: { v: 1, items: [] } },
        send,
      ),
    ).resolves.toBeUndefined();
  });
});
