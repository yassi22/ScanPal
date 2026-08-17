import type { Pool, PoolClient } from "pg";
import { plans, type Plan, type PlanId } from "@scanpal/shared";

/**
 * Credits/plan-helpers (plan 03). De webapp re-exporteert vanuit scan-core;
 * de scheduler en worker gebruiken dezelfde helpers.
 */
export type SubscriptionState = {
  team_id: string;
  plan: PlanId;
  status: string;
  current_period_end: Date | null;
  credits_used: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  interval: "month" | "year";
};

export class CreditLimitError extends Error {
  constructor(
    public creditsUsed: number,
    public creditsLimit: number,
  ) {
    super("Scan-limiet bereikt");
    this.name = "CreditLimitError";
  }
}

export class PlanFeatureError extends Error {
  constructor(
    public feature: string,
    public plan: PlanId,
  ) {
    super(`Functie "${feature}" is niet beschikbaar op dit plan`);
    this.name = "PlanFeatureError";
  }
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function creditsLimitFor(planId: PlanId): number {
  return plans[planId].creditsPerPeriod;
}

export async function getSubscriptionState(
  db: Pool | PoolClient,
  teamId: string,
): Promise<SubscriptionState | null> {
  const result = await db.query(
    `select team_id, plan, status, current_period_end, credits_used,
            stripe_customer_id, stripe_subscription_id,
            cancel_at_period_end, interval
     from subscriptions where team_id = $1`,
    [teamId],
  );
  return result.rowCount ? (result.rows[0] as SubscriptionState) : null;
}

export async function getPlanForTeam(
  db: Pool | PoolClient,
  teamId: string,
): Promise<Plan> {
  const state = await getSubscriptionState(db, teamId);
  return plans[state?.plan ?? "free"];
}

export type TeamUsage = {
  plan: Plan;
  status: string;
  creditsUsed: number;
  creditsLimit: number;
  currentPeriodEnd: Date | null;
  resetAt: Date | null;
};

export async function getTeamUsage(
  db: Pool | PoolClient,
  teamId: string,
): Promise<TeamUsage> {
  const state = await getSubscriptionState(db, teamId);
  const planId = state?.plan ?? "free";
  const plan = plans[planId];
  const status = state?.status ?? "active";
  const creditsUsed = state?.credits_used ?? 0;

  const active = ACTIVE_STATUSES.has(status);
  const creditsLimit = !state || active ? plan.creditsPerPeriod : 0;

  return {
    plan,
    status,
    creditsUsed,
    creditsLimit,
    currentPeriodEnd: state?.current_period_end ?? null,
    resetAt: state?.current_period_end ?? null,
  };
}

async function ensureSubscriptionRow(
  client: PoolClient,
  teamId: string,
): Promise<void> {
  await client.query(
    `insert into subscriptions (team_id, plan, status, current_period_end, updated_at)
     values ($1, 'free', 'active', now() + interval '30 days', now())
     on conflict (team_id) do nothing`,
    [teamId],
  );
}

export type SpendResult = {
  plan: PlanId;
  creditsUsed: number;
  creditsLimit: number;
};

/**
 * Boekt atoom één credit af. Verwacht een open transactie (client).
 * Werpt CreditLimitError als de limiet bereikt is.
 */
export async function spendCredit(
  client: PoolClient,
  input: { teamId: string; reason: string; scanId?: string },
): Promise<SpendResult> {
  await ensureSubscriptionRow(client, input.teamId);

  const locked = await client.query(
    `select plan, status, current_period_end, credits_used
     from subscriptions where team_id = $1 for update`,
    [input.teamId],
  );
  const sub = locked.rows[0] as SubscriptionState | undefined;
  const planId = sub?.plan ?? "free";
  const limit = creditsLimitFor(planId);

  if (!sub || !ACTIVE_STATUSES.has(sub.status)) {
    throw new CreditLimitError(sub?.credits_used ?? limit, limit);
  }

  if (sub.current_period_end && sub.current_period_end < new Date()) {
    await client.query(
      `update subscriptions set credits_used = 0, updated_at = now(),
         current_period_end = case
           when stripe_subscription_id is null then now() + interval '30 days'
           else current_period_end
         end
       where team_id = $1`,
      [input.teamId],
    );
    sub.credits_used = 0;
  }

  const spent = await client.query(
    `update subscriptions set credits_used = credits_used + 1, updated_at = now()
     where team_id = $1 and credits_used < $2
     returning credits_used`,
    [input.teamId, limit],
  );

  if (spent.rowCount === 0) {
    throw new CreditLimitError(sub.credits_used, limit);
  }

  await client.query(
    `insert into credit_transactions (team_id, amount, reason, scan_id)
     values ($1, 1, $2, $3)`,
    [input.teamId, input.reason, input.scanId ?? null],
  );

  return {
    plan: planId,
    creditsUsed: spent.rows[0].credits_used as number,
    creditsLimit: limit,
  };
}

/**
 * Boekt atoom één credit terug bij een gecancelde scan (plan 19).
 * Idempotent: refundt alleen als er een `amount = 1`-transactie met deze
 * scan_id bestaat én er nog geen `scan_cancel`-refund voor is; `credits_used`
 * klemt op 0. Verwacht een open transactie. Retourneert of er een refund is
 * uitgevoerd.
 */
export async function refundCredit(
  client: PoolClient,
  input: { teamId: string; scanId: string },
): Promise<boolean> {
  const spent = await client.query(
    `select 1 from credit_transactions ct
      where ct.team_id = $1 and ct.scan_id = $2 and ct.amount = 1
        and not exists (
          select 1 from credit_transactions r
          where r.team_id = ct.team_id
            and r.scan_id = ct.scan_id
            and r.amount = -1
            and r.reason = 'scan_cancel'
        )
      limit 1`,
    [input.teamId, input.scanId],
  );
  if (spent.rowCount === 0) return false;

  await client.query(
    `update subscriptions set credits_used = greatest(credits_used - 1, 0), updated_at = now()
     where team_id = $1`,
    [input.teamId],
  );
  await client.query(
    `insert into credit_transactions (team_id, amount, reason, scan_id)
     values ($1, -1, 'scan_cancel', $2)`,
    [input.teamId, input.scanId],
  );
  return true;
}

export async function assertPlanFeature(
  db: Pool | PoolClient,
  teamId: string,
  feature: "uptime" | "github",
): Promise<Plan> {
  const plan = await getPlanForTeam(db, teamId);
  if (!plan.features[feature]) {
    throw new PlanFeatureError(feature, plan.id);
  }
  return plan;
}