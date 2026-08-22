import type { Pool, PoolClient } from "pg";
import { planIdSchema, type PlanId, type SubscriptionStatus } from "@scanpal/shared";

type StripeObject = {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  status?: string | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  amount_due?: number | null;
  metadata?: Record<string, string> | null;
  items?: {
    data?: { price?: { id?: string; recurring?: { interval?: string } | null } | null }[] | null;
  } | null;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: StripeObject };
};

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

const CHECKOUT_TYPES = new Set(["checkout.session.completed"]);
const SUBSCRIPTION_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const INVOICE_TYPES = new Set(["invoice.payment_failed"]);
const SUPPORTED_TYPES = new Set([
  ...CHECKOUT_TYPES,
  ...SUBSCRIPTION_TYPES,
  ...INVOICE_TYPES,
]);

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "past_due",
  incomplete_expired: "canceled",
  unpaid: "past_due",
  paused: "past_due",
};

function toDate(unixSeconds: number | null | undefined): Date | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000);
}

export async function processStripeEvent(
  db: Pool,
  event: StripeWebhookEvent,
  resolvePlanFromPrice: (priceId: string | undefined) => PlanId | null,
): Promise<WebhookOutcome> {
  if (!SUPPORTED_TYPES.has(event.type)) return "ignored";

  const object = event.data.object;
  const client = await db.connect();

  try {
    await client.query("begin");

    const seen = await client.query(
      `insert into webhook_events (stripe_event_id, type) values ($1, $2)
       on conflict (stripe_event_id) do nothing
       returning id`,
      [event.id, event.type],
    );
    if (seen.rowCount === 0) {
      await client.query("commit");
      return "duplicate";
    }

    if (CHECKOUT_TYPES.has(event.type)) {
      await handleCheckoutCompleted(client, object);
    } else if (SUBSCRIPTION_TYPES.has(event.type)) {
      await handleSubscriptionEvent(
        client,
        object,
        resolvePlanFromPrice,
        event.type === "customer.subscription.deleted",
      );
    } else if (INVOICE_TYPES.has(event.type)) {
      // Geen DB-werk: alleen de idempotentie-registratie hierboven. De route
      // stuurt op basis hiervan de payment_failed-notificatie (plan 16) —
      // bij dunning-retries is dit event "duplicate" en volgt er geen 2e
      // melding (notify-dedup via invoice-id als backstop).
    }

    await client.query("commit");
    return "processed";
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function handleCheckoutCompleted(
  client: PoolClient,
  object: StripeObject,
): Promise<void> {
  const teamId = object.metadata?.team_id;
  if (!teamId || !object.subscription) return;

  // Plan komt uit checkout-metadata; legacy events zonder (of met ongeldig)
  // plan_id vallen terug op "pro" (het historische default-plan).
  const parsedPlan = planIdSchema.safeParse(object.metadata?.plan_id);
  const plan: PlanId = parsedPlan.success ? parsedPlan.data : "pro";

  await client.query(
    `insert into subscriptions (team_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
     values ($1, $2, 'active', $3, $4, $5, now())
     on conflict (team_id) do update set
       plan = excluded.plan,
       status = excluded.status,
       stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
       current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
       updated_at = now()`,
    [
      teamId,
      plan,
      object.customer ?? null,
      object.subscription,
      toDate(object.current_period_end),
    ],
  );
}

async function handleSubscriptionEvent(
  client: PoolClient,
  object: StripeObject,
  resolvePlanFromPrice: (priceId: string | undefined) => PlanId | null,
  isDeletion: boolean,
): Promise<void> {
  const subscriptionId = object.id;
  const customerId = object.customer ?? undefined;

  // Bij een definitieve annulering matchen we uitsluitend op
  // stripe_subscription_id: dat is precies het abonnement dat wordt
  // verwijderd. Matchen op customer_id zou een vertraagd/oud deleted-event
  // (andere event-id, dus voorbij de webhook_events-dedup) een ná een nieuw
  // abonnement van dezelfde customer kunnen laten wippen naar free.
  const found = await client.query(
    isDeletion
      ? `select team_id from subscriptions
         where stripe_subscription_id = $1
         limit 1`
      : `select team_id from subscriptions
         where (stripe_subscription_id = $1 and $1 is not null)
            or (stripe_customer_id = $2 and $2 is not null)
         limit 1`,
    isDeletion ? [subscriptionId ?? null] : [subscriptionId ?? null, customerId ?? null],
  );
  if (found.rowCount === 0) return;

  // Definitieve annulering (einde periode of directe cancel): het team valt
  // terug naar een schone Free-staat. stripe_subscription_id wordt gewist zodat
  // de UI de team als Free (active) toont en de Free-credits gelden; de
  // stripe_customer_id blijft bewaard voor de facturenhistorie en hergebruik
  // bij een volgend abonnement.
  if (isDeletion) {
    await client.query(
      `update subscriptions set
         plan = 'free',
         status = 'active',
         cancel_at_period_end = false,
         stripe_subscription_id = null,
         current_period_end = null,
         updated_at = now()
       where team_id = $1`,
      [found.rows[0].team_id],
    );
    return;
  }

  const priceId = object.items?.data?.[0]?.price?.id;
  const plan = resolvePlanFromPrice(priceId);
  const status = STATUS_MAP[object.status ?? ""] ?? "past_due";
  const periodEnd = toDate(object.current_period_end);
  const cancelAtPeriodEnd = object.cancel_at_period_end ?? null;
  const interval = object.items?.data?.[0]?.price?.recurring?.interval;

  await client.query(
    `update subscriptions set
       status = $2,
       current_period_end = coalesce($3, current_period_end),
       stripe_customer_id = coalesce($4, stripe_customer_id),
       stripe_subscription_id = coalesce($5, stripe_subscription_id),
       cancel_at_period_end = coalesce($6, cancel_at_period_end),
       updated_at = now()
     where team_id = $1`,
    [
      found.rows[0].team_id,
      status,
      periodEnd,
      customerId ?? null,
      subscriptionId ?? null,
      cancelAtPeriodEnd,
    ],
  );

  if (plan) {
    await client.query(
      "update subscriptions set plan = $2, updated_at = now() where team_id = $1",
      [found.rows[0].team_id, plan],
    );
  }

  if (interval === "month" || interval === "year") {
    await client.query(
      "update subscriptions set interval = $2, updated_at = now() where team_id = $1",
      [found.rows[0].team_id, interval],
    );
  }
}

/** Team-id van een subscription bij een Stripe customer (voor de
 *  payment_failed-notificatie in de webhook-route). Geen match → null. */
export async function findTeamIdByStripeCustomer(
  db: Pool,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  const result = await db.query(
    "select team_id from subscriptions where stripe_customer_id = $1 limit 1",
    [customerId],
  );
  return result.rowCount ? (result.rows[0].team_id as string) : null;
}
