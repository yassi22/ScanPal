import type { PoolClient } from "pg";
import { plans, type PlanId } from "@scanpal/shared";

export class CreditLimitError extends Error {
  constructor(
    public creditsUsed: number,
    public creditsLimit: number,
  ) {
    super("Scan-limiet bereikt");
    this.name = "CreditLimitError";
  }
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

type SubscriptionState = {
  team_id: string;
  plan: PlanId;
  status: string;
  current_period_end: Date | null;
  credits_used: number;
};

/**
 * Tijdelijke kopie van apps/web/lib/credits.ts (spendCredit) — de webapp-lib
 * importeert server-only en is daardoor niet bruikbaar vanuit dit Node-proces.
 * Zodra de BullMQ-pipeline (Fase 3) er is, verhuist de credit-logica naar een
 * gedeelde worker-lib en verdwijnt deze kopie.
 */
export async function spendScheduleCredit(
  client: PoolClient,
  input: { teamId: string; reason: string; scanId?: string },
): Promise<void> {
  await client.query(
    `insert into subscriptions (team_id, plan, status, current_period_end, updated_at)
     values ($1, 'free', 'active', now() + interval '30 days', now())
     on conflict (team_id) do nothing`,
    [input.teamId],
  );

  const locked = await client.query(
    `select plan, status, current_period_end, credits_used
     from subscriptions where team_id = $1 for update`,
    [input.teamId],
  );
  const sub = locked.rows[0] as SubscriptionState | undefined;
  const planId = sub?.plan ?? "free";
  const limit = plans[planId].creditsPerPeriod;

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
}
