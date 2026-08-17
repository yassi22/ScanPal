import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  spendCredit,
  refundCredit,
  getTeamUsage,
  getPlanForTeam,
  assertPlanFeature,
  CreditLimitError,
  PlanFeatureError,
} from "../../lib/credits";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeSubscription = {
  team_id: string;
  plan: string;
  status: string;
  current_period_end: Date | null;
  credits_used: number;
  stripe_subscription_id: string | null;
};

type FakeTransaction = {
  team_id: string;
  amount: number;
  reason: string;
  scan_id: string | null;
};

function fakePool() {
  const subscriptions = new Map<string, FakeSubscription>();
  const transactions: FakeTransaction[] = [];

  function handle(sql: string, params: unknown[] = []): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();
    const teamId = params[0] as string;

    if (text === "begin" || text === "commit" || text === "rollback") {
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("insert into subscriptions")) {
      if (!subscriptions.has(teamId)) {
        subscriptions.set(teamId, {
          team_id: teamId,
          plan: "free",
          status: "active",
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          credits_used: 0,
          stripe_subscription_id: null,
        });
      }
      return { rowCount: subscriptions.has(teamId) ? 1 : 0, rows: [] };
    }

    if (
      text.startsWith("select plan, status, current_period_end, credits_used") ||
      text.startsWith("select team_id, plan, status, current_period_end")
    ) {
      const sub = subscriptions.get(teamId);
      return sub ? { rowCount: 1, rows: [{ ...sub }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("update subscriptions set credits_used = 0")) {
      const sub = subscriptions.get(teamId);
      if (sub) {
        sub.credits_used = 0;
        if (!sub.stripe_subscription_id) {
          sub.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }
      }
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    if (text.startsWith("update subscriptions set credits_used = credits_used + 1")) {
      const sub = subscriptions.get(teamId);
      const limit = params[1] as number;
      if (!sub || sub.credits_used >= limit) return { rowCount: 0, rows: [] };
      sub.credits_used += 1;
      return { rowCount: 1, rows: [{ credits_used: sub.credits_used }] };
    }

    if (text.startsWith("insert into credit_transactions")) {
      const amountMatch = /values \(\$1, (-?\d+)/.exec(text);
      const amount = amountMatch ? Number(amountMatch[1]) : 1;
      const literalReason = /'([a-z_]+)'/.exec(text);
      const reason = literalReason
        ? literalReason[1]
        : (params[1] as string);
      const scanId = literalReason
        ? (params[1] as string | null)
        : ((params[2] as string | null) ?? null);
      transactions.push({
        team_id: params[0] as string,
        amount,
        reason,
        scan_id: scanId ?? null,
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select 1 from credit_transactions")) {
      const scanId = params[1] as string;
      const spent = transactions.some(
        (t) => t.team_id === teamId && t.scan_id === scanId && t.amount === 1,
      );
      const refunded = transactions.some(
        (t) =>
          t.team_id === teamId &&
          t.scan_id === scanId &&
          t.amount === -1 &&
          t.reason === "scan_cancel",
      );
      return spent && !refunded
        ? { rowCount: 1, rows: [{ 1: 1 }] }
        : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("update subscriptions set credits_used = greatest")) {
      const sub = subscriptions.get(teamId);
      if (sub) sub.credits_used = Math.max(sub.credits_used - 1, 0);
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    throw new Error(`Onverwachte query in test-fake: ${text}`);
  }

  const client = {
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
    release: () => {},
  } as unknown as PoolClient;

  const db = {
    connect: async () => client,
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
  } as unknown as Pool;

  return { db, client, subscriptions, transactions };
}

describe("spendCredit", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("boekt een credit af en schrijft een audittransactie", async () => {
    const result = await spendCredit(state.client, {
      teamId: "team-1",
      reason: "scan",
      scanId: "scan-1",
    });

    expect(result.plan).toBe("free");
    expect(result.creditsUsed).toBe(1);
    expect(result.creditsLimit).toBe(5);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(1);
    expect(state.transactions).toEqual([
      { team_id: "team-1", amount: 1, reason: "scan", scan_id: "scan-1" },
    ]);
  });

  it("maakt automatisch een free-abonnement aan voor een nieuw team", async () => {
    await spendCredit(state.client, { teamId: "team-1", reason: "scan" });

    const sub = state.subscriptions.get("team-1");
    expect(sub).toBeDefined();
    expect(sub?.plan).toBe("free");
    expect(sub?.status).toBe("active");
    expect(sub?.current_period_end).toBeInstanceOf(Date);
  });

  it("gooit CreditLimitError bij de limiet en boekt niets", async () => {
    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "free",
      status: "active",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 5,
      stripe_subscription_id: null,
    });

    await expect(
      spendCredit(state.client, { teamId: "team-1", reason: "scan" }),
    ).rejects.toBeInstanceOf(CreditLimitError);

    try {
      await spendCredit(state.client, { teamId: "team-1", reason: "scan" });
    } catch (err) {
      const limitError = err as CreditLimitError;
      expect(limitError.creditsUsed).toBe(5);
      expect(limitError.creditsLimit).toBe(5);
    }
    expect(state.transactions).toHaveLength(0);
  });

  it("reset lui de periode wanneer current_period_end is verstreken", async () => {
    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "free",
      status: "active",
      current_period_end: new Date(Date.now() - 1000),
      credits_used: 5,
      stripe_subscription_id: null,
    });

    const result = await spendCredit(state.client, { teamId: "team-1", reason: "scan" });

    expect(result.creditsUsed).toBe(1);
    const sub = state.subscriptions.get("team-1")!;
    expect(sub.credits_used).toBe(1);
    expect(sub.current_period_end!.getTime()).toBeGreaterThan(Date.now());
  });

  it("blokkeert scans op een geannuleerd abonnement", async () => {
    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "pro",
      status: "canceled",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 0,
      stripe_subscription_id: "sub_1",
    });

    await expect(
      spendCredit(state.client, { teamId: "team-1", reason: "scan" }),
    ).rejects.toBeInstanceOf(CreditLimitError);
  });

  it("verwerkt gelijktijdige spends atoom tot aan de limiet", async () => {
    const attempts = Array.from({ length: 7 }, (_, i) =>
      spendCredit(state.client, { teamId: "team-1", reason: "scan", scanId: `scan-${i}` }),
    );

    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(2);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(5);
    expect(state.transactions).toHaveLength(5);
  });

  it("blokkeert pas bij de volgende scan na een downgrade", async () => {
    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "pro",
      status: "active",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 600,
      stripe_subscription_id: "sub_1",
    });

    await expect(
      spendCredit(state.client, { teamId: "team-1", reason: "scan" }),
    ).rejects.toBeInstanceOf(CreditLimitError);
  });
});

describe("getTeamUsage / getPlanForTeam / assertPlanFeature", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("geeft het free-plan en de limiet terug zonder abonnement", async () => {
    const usage = await getTeamUsage(state.db, "team-1");

    expect(usage.plan.id).toBe("free");
    expect(usage.creditsUsed).toBe(0);
    expect(usage.creditsLimit).toBe(5);
  });

  it("toont verbruik boven de limiet na een downgrade (geen dataverlies)", async () => {
    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "free",
      status: "active",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 12,
      stripe_subscription_id: null,
    });

    const usage = await getTeamUsage(state.db, "team-1");
    expect(usage.creditsUsed).toBe(12);
    expect(usage.creditsLimit).toBe(5);
    expect(usage.plan.id).toBe("free");
  });

  it("blokkeert uptime en github op free, staat ze toe op pro", async () => {
    await expect(
      assertPlanFeature(state.db, "team-1", "uptime"),
    ).rejects.toBeInstanceOf(PlanFeatureError);
    await expect(
      assertPlanFeature(state.db, "team-1", "github"),
    ).rejects.toBeInstanceOf(PlanFeatureError);

    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "pro",
      status: "active",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 0,
      stripe_subscription_id: "sub_1",
    });

    const plan = await assertPlanFeature(state.db, "team-1", "uptime");
    expect(plan.id).toBe("pro");
    await expect(assertPlanFeature(state.db, "team-1", "github")).resolves.toMatchObject({
      id: "pro",
    });
  });

  it("geeft het plan terug via getPlanForTeam", async () => {
    expect((await getPlanForTeam(state.db, "team-1")).id).toBe("free");

    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "pro",
      status: "active",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 0,
      stripe_subscription_id: "sub_1",
    });
    expect((await getPlanForTeam(state.db, "team-1")).id).toBe("pro");
  });
});

describe("refundCredit", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("refundt een credit na een spend en schrijft een -1-transactie", async () => {
    await spendCredit(state.client, {
      teamId: "team-1",
      reason: "scan",
      scanId: "scan-1",
    });

    const refunded = await refundCredit(state.client, {
      teamId: "team-1",
      scanId: "scan-1",
    });

    expect(refunded).toBe(true);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(0);
    expect(state.transactions).toEqual([
      { team_id: "team-1", amount: 1, reason: "scan", scan_id: "scan-1" },
      {
        team_id: "team-1",
        amount: -1,
        reason: "scan_cancel",
        scan_id: "scan-1",
      },
    ]);
  });

  it("is idempotent: een dubbele refund wordt geen tweede refund", async () => {
    await spendCredit(state.client, {
      teamId: "team-1",
      reason: "scan",
      scanId: "scan-1",
    });

    await refundCredit(state.client, { teamId: "team-1", scanId: "scan-1" });
    const again = await refundCredit(state.client, {
      teamId: "team-1",
      scanId: "scan-1",
    });

    expect(again).toBe(false);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(0);
    const refunds = state.transactions.filter((t) => t.amount === -1);
    expect(refunds).toHaveLength(1);
  });

  it("is een no-op zonder eerdere spend", async () => {
    const refunded = await refundCredit(state.client, {
      teamId: "team-1",
      scanId: "scan-1",
    });

    expect(refunded).toBe(false);
    expect(state.transactions).toHaveLength(0);
    expect(state.subscriptions.has("team-1")).toBe(false);
  });

  it("klemt credits_used op 0", async () => {
    state.subscriptions.set("team-1", {
      team_id: "team-1",
      plan: "free",
      status: "active",
      current_period_end: new Date(Date.now() + 100000),
      credits_used: 0,
      stripe_subscription_id: null,
    });
    state.transactions.push({
      team_id: "team-1",
      amount: 1,
      reason: "scan",
      scan_id: "scan-1",
    });

    const refunded = await refundCredit(state.client, {
      teamId: "team-1",
      scanId: "scan-1",
    });

    expect(refunded).toBe(true);
    expect(state.subscriptions.get("team-1")?.credits_used).toBe(0);
  });

  it("refundt meerdere scans onafhankelijk", async () => {
    await spendCredit(state.client, {
      teamId: "team-1",
      reason: "scan",
      scanId: "scan-1",
    });
    await spendCredit(state.client, {
      teamId: "team-1",
      reason: "scan",
      scanId: "scan-2",
    });

    await refundCredit(state.client, { teamId: "team-1", scanId: "scan-1" });

    expect(state.subscriptions.get("team-1")?.credits_used).toBe(1);
    const refunds = state.transactions.filter((t) => t.amount === -1);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].scan_id).toBe("scan-1");
  });
});
