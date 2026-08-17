import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  getHoneypotByToken,
  honeypotSnippet,
  listThreatEvents,
  listThreatOverviews,
  recordHoneypotHit,
  setHoneypot,
} from "@/lib/threats-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { honeypotBaseUrl: "https://honeypot.scanpal.app", appUrl: "http://localhost:3000" },
}));

const SITE_ID = "00000000-0000-4000-8000-000000000002";
const TEAM_ID = "00000000-0000-4000-8000-000000000003";

const HONEYPOT = {
  id: "00000000-0000-4000-8000-000000000001",
  site_id: SITE_ID,
  team_id: TEAM_ID,
  token: "secret-token",
  enabled: true,
  hit_count: 10,
  created_at: new Date("2026-08-16T08:00:00Z"),
};

const HIT = { path: "/h/secret-token", ip: "203.0.113.10", userAgent: "Mozilla/5.0" };

function makePool() {
  const query = vi.fn();
  return { pool: { query } as unknown as Pool, query };
}

describe("honeypotSnippet", () => {
  it("bouwt de install-snippet met de honeypot-URL", () => {
    const snippet = honeypotSnippet("secret-token");
    expect(snippet.url).toBe("https://honeypot.scanpal.app/h/secret-token");
    expect(snippet.html).toContain("https://honeypot.scanpal.app/h/secret-token");
    expect(snippet.html).toContain('rel="nofollow"');
    expect(snippet.html).toContain('aria-hidden="true"');
  });
});

describe("getHoneypotByToken", () => {
  it("retourneert de honeypot met team_id via de site-join", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 1, rows: [HONEYPOT] } as never);
    const result = await getHoneypotByToken(pool, "secret-token");
    expect(result?.team_id).toBe(TEAM_ID);
    expect(query.mock.calls[0][0]).toContain("join sites");
  });

  it("geeft null bij een onbekende token", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    expect(await getHoneypotByToken(pool, "onbekend")).toBeNull();
  });
});

describe("recordHoneypotHit", () => {
  it("insert een hit-event en verhoogt hit_count", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "00000000-0000-4000-8000-000000000099" }],
    } as never);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);

    const result = await recordHoneypotHit(pool, HONEYPOT, HIT);
    expect(result.eventId).toBe("00000000-0000-4000-8000-000000000099");
    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into threat_events"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toEqual([
      TEAM_ID,
      SITE_ID,
      HONEYPOT.id,
      HIT.path,
      HIT.ip,
      HIT.userAgent,
    ]);
  });

  it("dedupliceert dezelfde IP binnen 10 seconden (alleen counter)", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "x" }] } as never);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);

    const result = await recordHoneypotHit(pool, HONEYPOT, HIT);
    expect(result.eventId).toBeNull();
    const updateCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("set hit_count = hit_count + 1"),
    );
    expect(updateCall).toBeDefined();
    expect(query.mock.calls.find(([sql]) => String(sql).includes("insert into threat_events"))).toBeUndefined();
  });

  it("slaat de dedup-check over zonder IP", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "00000000-0000-4000-8000-000000000099" }],
    } as never);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);

    const result = await recordHoneypotHit(pool, HONEYPOT, { ...HIT, ip: null });
    expect(result.eventId).toBe("00000000-0000-4000-8000-000000000099");
    const dedupCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("interval '10 seconds'"),
    );
    expect(dedupCall).toBeUndefined();
  });
});

describe("setHoneypot", () => {
  it("maakt een honeypot aan en retourneert view + snippet", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: SITE_ID }] } as never);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: HONEYPOT.id,
          site_id: SITE_ID,
          team_id: TEAM_ID,
          token: "new-token",
          enabled: true,
          hit_count: 0,
          created_at: HONEYPOT.created_at,
          site_url: "voorbeeld.nl",
          site_label: null,
        },
      ],
    } as never);

    const result = await setHoneypot(pool, TEAM_ID, SITE_ID, {
      enabled: true,
      rotateToken: false,
    });
    expect(result).not.toBeNull();
    expect(result?.view.site_url).toBe("voorbeeld.nl");
    expect(result?.view.url).toContain("/h/new-token");
    expect(result?.snippet.url).toBe("https://honeypot.scanpal.app/h/new-token");

    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("on conflict (site_id)"),
    );
    expect(insertCall).toBeDefined();
  });

  it("roteert het token bij rotate_token=true", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: SITE_ID }] } as never);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: HONEYPOT.id,
          site_id: SITE_ID,
          team_id: TEAM_ID,
          token: "geroteerd-token",
          enabled: true,
          hit_count: 10,
          created_at: HONEYPOT.created_at,
          site_url: "voorbeeld.nl",
          site_label: null,
        },
      ],
    } as never);

    const result = await setHoneypot(pool, TEAM_ID, SITE_ID, {
      enabled: true,
      rotateToken: true,
    });
    expect(result?.view.url).toContain("/h/geroteerd-token");

    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("on conflict (site_id)"),
    );
    expect(insertCall?.[1]?.[3]).toBe(true);
  });

  it("geeft null voor een site die niet van het team is", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    expect(
      await setHoneypot(pool, TEAM_ID, SITE_ID, { enabled: true, rotateToken: false }),
    ).toBeNull();
  });
});

describe("listThreatOverviews", () => {
  it("retourneert lege lijst zonder honeypots", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    expect(await listThreatOverviews(pool, TEAM_ID)).toEqual([]);
  });

  it("combineert honeypot, last event, high-risk-count en actieve patronen", async () => {
    const { pool, query } = makePool();
    const honeypotRow = {
      id: HONEYPOT.id,
      site_id: SITE_ID,
      team_id: TEAM_ID,
      token: "secret-token",
      enabled: true,
      hit_count: 10,
      created_at: HONEYPOT.created_at,
      site_url: "voorbeeld.nl",
      site_label: null,
    };
    query.mockResolvedValueOnce({ rowCount: 1, rows: [honeypotRow] } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000099",
          team_id: TEAM_ID,
          site_id: SITE_ID,
          honeypot_id: HONEYPOT.id,
          kind: "pattern",
          risk: "high",
          path: "/h/secret-token/.env",
          ip: "203.0.113.10",
          user_agent: "sqlmap/1.7",
          country: null,
          asn: null,
          matched_rule: "path_env",
          payload: {},
          created_at: new Date("2026-08-16T09:00:00Z"),
        },
      ],
    } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ honeypot_id: HONEYPOT.id, n: 1 }],
    } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ honeypot_id: HONEYPOT.id, rule_key: "path_env" }],
    } as never);

    const [overview] = await listThreatOverviews(pool, TEAM_ID);
    expect(overview.site.hit_count).toBe(10);
    expect(overview.last_event?.kind).toBe("pattern");
    expect(overview.last_event?.matched_rule).toBe("path_env");
    expect(overview.high_risk_count).toBe(1);
    expect(overview.active_patterns).toEqual(["path_env"]);
  });
});

describe("listThreatEvents", () => {
  it("bouwt filters en paginering op", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ n: 0 }],
    } as never);

    const result = await listThreatEvents(pool, TEAM_ID, {
      site_id: SITE_ID,
      risk: "high",
      kind: "pattern",
      page: 2,
      page_size: 25,
    });
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);

    const listCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("order by e.created_at desc"),
    );
    expect(listCall).toBeDefined();
    expect(listCall?.[1]).toEqual([TEAM_ID, SITE_ID, "high", "pattern", 25, 25]);
  });

  it("draait zonder filters alleen op team-scoping", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ n: 0 }] } as never);

    await listThreatEvents(pool, TEAM_ID, { page: 1, page_size: 25 });
    const listCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("order by e.created_at desc"),
    );
    expect(listCall?.[1]).toEqual([TEAM_ID, 25, 0]);
  });
});
