import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { analyzeThreatHit, type ThreatHit } from "@/lib/threat-rules";

vi.mock("server-only", () => ({}));

type RuleRow = {
  id: string;
  name: string;
  rule_key: string;
  risk: string;
  description: string;
  enabled: boolean;
};

const RISK_OF: Record<string, string> = {
  burst: "medium",
  path_admin: "medium",
  path_env: "high",
  path_traversal: "critical",
  ua_scanner: "low",
  ip_repeat: "medium",
};

const HONEYPOT = {
  id: "00000000-0000-4000-8000-000000000001",
  site_id: "00000000-0000-4000-8000-000000000002",
  team_id: "00000000-0000-4000-8000-000000000003",
  token: "abc",
  enabled: true,
  hit_count: 10,
  created_at: new Date("2026-08-16T08:00:00Z"),
};

function makePool(allRules: string[] = Object.keys(RISK_OF)) {
  const rules: RuleRow[] = allRules.map((key, i) => ({
    id: `rule-${i}`,
    name: key,
    rule_key: key,
    risk: RISK_OF[key],
    description: "",
    enabled: true,
  }));
  const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  query.mockResolvedValueOnce({ rowCount: rules.length, rows: rules } as never);
  return { pool: { query } as unknown as Pool, query };
}

function hit(overrides: Partial<ThreatHit> = {}): ThreatHit {
  return {
    path: "/h/abc",
    ip: "203.0.113.10",
    userAgent: "Mozilla/5.0",
    ...overrides,
  };
}

describe("analyzeThreatHit — pad-regels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detecteert wp-login als path_admin (medium)", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(pool, HONEYPOT, hit({ path: "/wp-login.php" }));
    expect(match).toEqual({ rule_key: "path_admin", risk: "medium" });
  });

  it("detecteert .env als path_env (high)", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(pool, HONEYPOT, hit({ path: "/.env" }));
    expect(match).toEqual({ rule_key: "path_env", risk: "high" });
  });

  it("detecteert traversal als path_traversal (critical)", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(
      pool,
      HONEYPOT,
      hit({ path: "/..%2f..%2fetc/passwd" }),
    );
    expect(match).toEqual({ rule_key: "path_traversal", risk: "critical" });
  });

  it("kiest de hoogste risk bij meerdere matches (env > admin)", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(
      pool,
      HONEYPOT,
      hit({ path: "/admin/.env" }),
    );
    expect(match).toEqual({ rule_key: "path_env", risk: "high" });
  });

  it("kiest critical boven high (traversal + env)", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(
      pool,
      HONEYPOT,
      hit({ path: "/.env/../../etc/passwd" }),
    );
    expect(match).toEqual({ rule_key: "path_traversal", risk: "critical" });
  });

  it("geen match op een normaal pad", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(pool, HONEYPOT, hit({ path: "/index.html" }));
    expect(match).toBeNull();
  });
});

describe("analyzeThreatHit — UA-regel", () => {
  it("detecteert sqlmap als ua_scanner (low)", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(
      pool,
      HONEYPOT,
      hit({ userAgent: "sqlmap/1.7" }),
    );
    expect(match).toEqual({ rule_key: "ua_scanner", risk: "low" });
  });

  it("laat een normale browser-UA ongemoeid", async () => {
    const { pool } = makePool();
    const match = await analyzeThreatHit(pool, HONEYPOT, hit());
    expect(match).toBeNull();
  });
});

describe("analyzeThreatHit — burst/IP-regels", () => {
  it("detecteert burst bij >= 5 hits in 60s (medium)", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({
      rowCount: 5,
      rows: [{ n: 5 }],
    } as never);
    query.mockResolvedValueOnce({
      rowCount: 5,
      rows: [{ n: 5 }],
    } as never);

    const match = await analyzeThreatHit(pool, HONEYPOT, hit());
    expect(match).toEqual({ rule_key: "burst", risk: "medium" });
  });

  it("detecteert ip_repeat bij >= 3 hits in 24u (medium)", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [{ n: 2 }] } as never);
    query.mockResolvedValueOnce({ rowCount: 0, rows: [{ n: 3 }] } as never);

    const match = await analyzeThreatHit(pool, HONEYPOT, hit());
    expect(match).toEqual({ rule_key: "ip_repeat", risk: "medium" });
  });

  it("geen match bij lage aantallen", async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce({ rowCount: 0, rows: [{ n: 1 }] } as never);
    query.mockResolvedValueOnce({ rowCount: 0, rows: [{ n: 2 }] } as never);

    const match = await analyzeThreatHit(pool, HONEYPOT, hit());
    expect(match).toBeNull();
  });

  it("slaat burst/ip_repeat over zonder IP", async () => {
    const { pool, query } = makePool();
    const match = await analyzeThreatHit(pool, HONEYPOT, hit({ ip: null }));
    expect(match).toBeNull();
    expect(query).toHaveBeenCalledTimes(1); // alleen de rules-query
  });
});

describe("analyzeThreatHit — disabled regels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draait alleen de enabled regels uit de DB", async () => {
    const { pool } = makePool(["burst", "ip_repeat"]);
    const match = await analyzeThreatHit(
      pool,
      HONEYPOT,
      hit({ path: "/.env" }),
    );
    expect(match).toBeNull(); // path_env staat niet in de DB → niet gedetecteerd
  });
});
