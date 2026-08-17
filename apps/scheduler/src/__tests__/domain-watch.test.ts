import { describe, it, expect, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import {
  processDueDomainChecks,
  type DomainNotifier,
} from "../domain-watch";
import type { DomainAlert, DomainMeasurement } from "@scanpal/shared";

type FakeSite = { id: string; team_id: string; url: string; label: string | null };

function fakePool(sites: FakeSite[]) {
  const db = {
    query: vi.fn(async (sql: string): Promise<QueryResult<QueryResultRow>> => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("select id, team_id, url, label")) {
        return {
          rows: sites as unknown as QueryResultRow[],
          rowCount: sites.length,
        } as unknown as QueryResult<QueryResultRow>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<QueryResultRow>;
    }),
  };
  return db as unknown as Pool;
}

const NOW = new Date("2026-08-17T00:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function measurement(over: Partial<DomainMeasurement> = {}): DomainMeasurement {
  return {
    domain_expiry: inDays(120),
    domain_registrar: "Example Registrar",
    dnssec_enabled: true,
    caa_present: false,
    tls_expiry: inDays(90),
    nameservers: ["ns1.example.com", "ns2.example.com"],
    caa_records: [],
    ...over,
  };
}

describe("processDueDomainChecks", () => {
  it("haalt due sites op, meet, persisteert en alert bij verandering", async () => {
    const sites: FakeSite[] = [
      { id: "s1", team_id: "t1", url: "example.com", label: null },
    ];
    const db = fakePool(sites);

    const measure = vi.fn().mockResolvedValue({
      measurement: measurement({ domain_expiry: inDays(10) }),
      rdap_ok: true,
    });
    const apply = vi.fn().mockResolvedValue({
      diffs: [{ field: "domain_expiry", old_value: inDays(120), new_value: inDays(10) }],
      alerts: [
        { field: "domain_expiry", summary: "Domein loopt af over 10 d" },
      ] as DomainAlert[],
    });
    const notified: unknown[] = [];
    const notify: DomainNotifier = async (input) => {
      notified.push(input);
    };

    const result = await processDueDomainChecks(db, {
      now: NOW,
      notify,
      measure,
      apply,
    });

    expect(result.due).toBe(1);
    expect(result.measured).toBe(1);
    expect(result.alerted).toBe(1);
    expect(measure).toHaveBeenCalledWith("example.com", undefined);
    expect(apply).toHaveBeenCalledWith(db, {
      siteId: "s1",
      measurement: expect.objectContaining({ domain_registrar: "Example Registrar" }),
      now: NOW,
    });
    expect(notified).toHaveLength(1);
    expect((notified[0] as { alert: DomainAlert }).alert.field).toBe("domain_expiry");
  });

  it("stuurt geen alert bij een meting zonder verandering", async () => {
    const db = fakePool([{ id: "s1", team_id: "t1", url: "https://example.com", label: null }]);
    const measure = vi.fn().mockResolvedValue({ measurement: measurement(), rdap_ok: true });
    const apply = vi.fn().mockResolvedValue({ diffs: [], alerts: [] });
    const notify = vi.fn();

    const result = await processDueDomainChecks(db, { now: NOW, notify, measure, apply });

    expect(result.measured).toBe(1);
    expect(result.alerted).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("breekt niet bij een falende meting (volgende poll probeert opnieuw)", async () => {
    const db = fakePool([
      { id: "s1", team_id: "t1", url: "https://broken.example", label: null },
      { id: "s2", team_id: "t1", url: "https://ok.example", label: "OK site" },
    ]);
    const measure = vi
      .fn()
      .mockRejectedValueOnce(new Error("rdap timeout"))
      .mockResolvedValueOnce({ measurement: measurement(), rdap_ok: true });
    const apply = vi.fn().mockResolvedValue({ diffs: [], alerts: [] });
    const result = await processDueDomainChecks(db, { now: NOW, notify: vi.fn(), measure, apply });

    expect(result.due).toBe(2);
    expect(result.measured).toBe(1);
  });

  it("gebruikt label als site_name fallback naar url", async () => {
    const db = fakePool([{ id: "s1", team_id: "t1", url: "https://example.com", label: "Mijn site" }]);
    const measure = vi.fn().mockResolvedValue({ measurement: measurement(), rdap_ok: true });
    const apply = vi.fn().mockResolvedValue({
      diffs: [],
      alerts: [{ field: "nameservers", summary: "drift" }] as DomainAlert[],
    });
    const notified: { siteName: string }[] = [];
    await processDueDomainChecks(db, {
      now: NOW,
      notify: async (input) => notified.push({ siteName: input.siteName }),
      measure,
      apply,
    });
    expect(notified[0].siteName).toBe("Mijn site");
  });
});
