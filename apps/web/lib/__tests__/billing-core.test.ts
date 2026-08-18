import { describe, it, expect, beforeEach } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  processStripeEvent,
  findTeamIdByStripeCustomer,
  type StripeWebhookEvent,
} from "../../lib/billing-core";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeSubscription = {
  team_id: string;
  plan: string;
  status: string;
  current_period_end: Date | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  interval: string;
};

function fakePool() {
  const subscriptions: FakeSubscription[] = [];
  const webhookEvents: string[] = [];

  function handle(sql: string, params: unknown[] = []): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text === "begin" || text === "commit" || text === "rollback") {
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("insert into webhook_events")) {
      const eventId = params[0] as string;
      if (webhookEvents.includes(eventId)) return { rowCount: 0, rows: [] };
      webhookEvents.push(eventId);
      return { rowCount: 1, rows: [{ id: "evt-row" }] };
    }

    if (text.startsWith("insert into subscriptions")) {
      const [teamId, plan, customerId, subscriptionId, periodEnd] = params as [
        string, string, string | null, string | null, Date | null,
      ];
      const existing = subscriptions.find((s) => s.team_id === teamId);
      if (existing) {
        existing.plan = plan;
        existing.status = "active";
        existing.stripe_customer_id = customerId ?? existing.stripe_customer_id;
        existing.stripe_subscription_id = subscriptionId ?? existing.stripe_subscription_id;
        existing.current_period_end = periodEnd ?? existing.current_period_end;
      } else {
        subscriptions.push({
          team_id: teamId,
          plan,
          status: "active",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
          interval: "month",
        });
      }
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select team_id from subscriptions where stripe_customer_id")) {
      const customerId = params[0] as string;
      const rows = subscriptions
        .filter((s) => s.stripe_customer_id === customerId)
        .map((s) => ({ team_id: s.team_id }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("select team_id from subscriptions")) {
      const [subscriptionId, customerId] = params as [string | null, string | null];
      const rows = subscriptions
        .filter(
          (s) =>
            (subscriptionId && s.stripe_subscription_id === subscriptionId) ||
            (customerId && s.stripe_customer_id === customerId),
        )
        .map((s) => ({ team_id: s.team_id }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("update subscriptions set status")) {
      const [teamId, status, periodEnd, customerId, subscriptionId, cancelAtPeriodEnd] = params as [
        string, string, Date | null, string | null, string | null, boolean | null,
      ];
      const sub = subscriptions.find((s) => s.team_id === teamId);
      if (sub) {
        sub.status = status;
        sub.current_period_end = periodEnd ?? sub.current_period_end;
        sub.stripe_customer_id = customerId ?? sub.stripe_customer_id;
        sub.stripe_subscription_id = subscriptionId ?? sub.stripe_subscription_id;
        if (cancelAtPeriodEnd !== null) sub.cancel_at_period_end = cancelAtPeriodEnd;
      }
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    if (text.startsWith("update subscriptions set interval")) {
      const [teamId, interval] = params as [string, string];
      const sub = subscriptions.find((s) => s.team_id === teamId);
      if (sub) sub.interval = interval;
      return { rowCount: sub ? 1 : 0, rows: [] };
    }

    if (text.startsWith("update subscriptions set plan")) {
      const [teamId, plan] = params as [string, string];
      const sub = subscriptions.find((s) => s.team_id === teamId);
      if (sub) sub.plan = plan;
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

  return { db, subscriptions, webhookEvents };
}

const resolvePlanFromPrice = (priceId: string | undefined) =>
  priceId === "price_pro" ? ("pro" as const) : priceId === "price_max" ? ("max" as const) : null;

function checkoutEvent(overrides: Partial<StripeWebhookEvent["data"]["object"]> = {}): StripeWebhookEvent {
  return {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        subscription: "sub_1",
        customer: "cus_1",
        metadata: { team_id: "team-1", plan_id: "pro" },
        ...overrides,
      },
    },
  };
}

describe("processStripeEvent", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("activeert een Pro-abonnement na checkout.session.completed", async () => {
    const outcome = await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    expect(outcome).toBe("processed");
    expect(state.subscriptions).toHaveLength(1);
    const sub = state.subscriptions[0];
    expect(sub).toMatchObject({
      team_id: "team-1",
      plan: "pro",
      status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
    });
    expect(state.webhookEvents).toEqual(["evt_checkout"]);
  });

  it("activeert een Max-abonnement op basis van metadata.plan_id", async () => {
    const outcome = await processStripeEvent(
      state.db,
      checkoutEvent({ metadata: { team_id: "team-2", plan_id: "max" } }),
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]).toMatchObject({
      team_id: "team-2",
      plan: "max",
      status: "active",
    });
  });

  it("valt terug op pro bij een legacy checkout zonder plan_id", async () => {
    const outcome = await processStripeEvent(
      state.db,
      checkoutEvent({ metadata: { team_id: "team-3" } }),
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    expect(state.subscriptions[0]).toMatchObject({
      team_id: "team-3",
      plan: "pro",
    });
  });

  it("valt terug op pro bij een ongeldig plan_id", async () => {
    const outcome = await processStripeEvent(
      state.db,
      checkoutEvent({ metadata: { team_id: "team-4", plan_id: "enterprise" } }),
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    expect(state.subscriptions[0]).toMatchObject({
      team_id: "team-4",
      plan: "pro",
    });
  });

  it("is idempotent: een dubbele event geeft geen dubbele verwerking", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);
    const second = await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    expect(second).toBe("duplicate");
    expect(state.subscriptions).toHaveLength(1);
    expect(state.webhookEvents).toHaveLength(1);
  });

  it("syncs status en periode bij customer.subscription.updated", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    const periodEnd = new Date("2026-09-15T00:00:00.000Z");
    const outcome = await processStripeEvent(
      state.db,
      {
        id: "evt_sub_updated",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "past_due",
            current_period_end: periodEnd.getTime() / 1000,
            items: { data: [{ price: { id: "price_pro" } }] },
          },
        },
      },
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    const sub = state.subscriptions[0];
    expect(sub.status).toBe("past_due");
    expect(sub.current_period_end?.toISOString()).toBe(periodEnd.toISOString());
    expect(sub.plan).toBe("pro");
  });

  it("verwerkt customer.subscription.deleted als geannuleerd", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    const outcome = await processStripeEvent(
      state.db,
      {
        id: "evt_sub_deleted",
        type: "customer.subscription.deleted",
        data: {
          object: { id: "sub_1", customer: "cus_1", status: "canceled" },
        },
      },
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    expect(state.subscriptions[0].status).toBe("canceled");
  });

  it("geeft ignored voor niet-ondersteunde event types", async () => {
    const outcome = await processStripeEvent(
      state.db,
      {
        id: "evt_unknown",
        type: "invoice.payment_succeeded",
        data: { object: { id: "in_1" } },
      },
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("ignored");
    expect(state.webhookEvents).toHaveLength(0);
  });

  it("slaat checkout over zonder team_id", async () => {
    const outcome = await processStripeEvent(
      state.db,
      checkoutEvent({ metadata: {} }),
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    expect(state.subscriptions).toHaveLength(0);
  });

  it("syncs cancel_at_period_end en interval bij subscription.updated", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    const outcome = await processStripeEvent(
      state.db,
      {
        id: "evt_sub_canceled",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            cancel_at_period_end: true,
            current_period_end: 1786885200,
            items: {
              data: [{ price: { id: "price_pro", recurring: { interval: "year" } } }],
            },
          },
        },
      },
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    const sub = state.subscriptions[0];
    expect(sub.cancel_at_period_end).toBe(true);
    expect(sub.interval).toBe("year");
  });

  it("verandert interval niet als het webhook-object het niet bevat", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    await processStripeEvent(
      state.db,
      {
        id: "evt_sub_nointerval",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            cancel_at_period_end: false,
            items: { data: [{ price: { id: "price_pro" } }] },
          },
        },
      },
      resolvePlanFromPrice,
    );

    expect(state.subscriptions[0].interval).toBe("month");
  });

  it("verwerkt invoice.payment_failed idempotent (voor de notificatie)", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    const invoiceEvent = {
      id: "evt_invoice_payment_failed",
      type: "invoice.payment_failed",
      data: {
        object: { id: "in_1", customer: "cus_1", amount_due: 2904, currency: "eur" },
      },
    };

    const first = await processStripeEvent(state.db, invoiceEvent, resolvePlanFromPrice);
    const second = await processStripeEvent(state.db, invoiceEvent, resolvePlanFromPrice);

    expect(first).toBe("processed");
    expect(second).toBe("duplicate");
    expect(state.webhookEvents).toEqual([
      "evt_checkout",
      "evt_invoice_payment_failed",
    ]);
  });

  it("vindt de team-id van een stripe-customer", async () => {
    await processStripeEvent(state.db, checkoutEvent(), resolvePlanFromPrice);

    const teamId = await findTeamIdByStripeCustomer(state.db, "cus_1");
    expect(teamId).toBe("team-1");

    expect(await findTeamIdByStripeCustomer(state.db, "cus_ghost")).toBeNull();
    expect(await findTeamIdByStripeCustomer(state.db, null)).toBeNull();
  });

  it("laat een onbekend abonnement ongemoeid", async () => {
    const outcome = await processStripeEvent(
      state.db,
      {
        id: "evt_ghost",
        type: "customer.subscription.updated",
        data: {
          object: { id: "sub_ghost", customer: "cus_ghost", status: "canceled" },
        },
      },
      resolvePlanFromPrice,
    );

    expect(outcome).toBe("processed");
    expect(state.subscriptions).toHaveLength(0);
  });
});
