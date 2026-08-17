import { z } from "zod";

export const planIdSchema = z.enum(["free", "pro"]);
export type PlanId = z.infer<typeof planIdSchema>;

export const subscriptionStatusSchema = z.enum([
  "active",
  "trialing",
  "past_due",
  "canceled",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export type Plan = {
  id: PlanId;
  name: string;
  priceCents: number;
  /** Jaarbedrag (plan 16): display-only voor de pricing-toggle; de echte
   *  prijs leeft in Stripe (STRIPE_PRICE_PRO_ANNUAL). 29000 = 2 maanden korting. */
  annualPriceCents?: number;
  creditsPerPeriod: number;
  maxMembers: number;
  /** API-verzoeken per minuut per key én per team (plan 14, feature 26). */
  apiRatePerMinute: number;
  /** Max outbound webhooks per team (plan 15, besluit). */
  maxWebhooks: number;
  features: {
    uptime: boolean;
    github: boolean;
    /** Plan 52: actieve vulnerability-tests (opt-in, alleen Pro). */
    activeTests: boolean;
    /** Plan 58: on-deploy triggers (GitHub/Vercel webhooks) — alleen Pro. */
    onDeploy: boolean;
  };
};

export const plans: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    creditsPerPeriod: 5,
    maxMembers: 3,
    apiRatePerMinute: 60,
    maxWebhooks: 1,
    features: { uptime: false, github: false, activeTests: false, onDeploy: false },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2900,
    annualPriceCents: 29000,
    creditsPerPeriod: 500,
    maxMembers: 10,
    apiRatePerMinute: 120,
    maxWebhooks: 3,
    features: { uptime: true, github: true, activeTests: true, onDeploy: true },
  },
};

export const planList: Plan[] = [plans.free, plans.pro];

export const publicPlanSchema = z.object({
  id: planIdSchema,
  name: z.string(),
  priceCents: z.number().int().nonnegative(),
  annualPriceCents: z.number().int().nonnegative().optional(),
  creditsPerPeriod: z.number().int().positive(),
  maxMembers: z.number().int().positive(),
  apiRatePerMinute: z.number().int().positive(),
  maxWebhooks: z.number().int().positive(),
  features: z.object({
    uptime: z.boolean(),
    github: z.boolean(),
    activeTests: z.boolean(),
    onDeploy: z.boolean(),
  }),
});
export type PublicPlan = z.infer<typeof publicPlanSchema>;

export const subscriptionSchema = z.object({
  team_id: z.string().uuid(),
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  plan: planIdSchema,
  status: subscriptionStatusSchema,
  current_period_end: z.string().datetime().nullable(),
  credits_used: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const usageSchema = z.object({
  plan: publicPlanSchema,
  status: subscriptionStatusSchema,
  creditsUsed: z.number().int().nonnegative(),
  creditsLimit: z.number().int().positive(),
  currentPeriodEnd: z.string().datetime().nullable(),
  resetAt: z.string().datetime().nullable(),
});
export type Usage = z.infer<typeof usageSchema>;
