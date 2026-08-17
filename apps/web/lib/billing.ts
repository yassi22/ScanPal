import "server-only";

import type { Pool } from "pg";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { getSubscriptionState } from "@/lib/credits";
import type { PlanId, SubscriptionInterval, SubscriptionStatus } from "@scanpal/shared";

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("Stripe is niet geconfigureerd");
    this.name = "BillingNotConfiguredError";
  }
}

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.stripeSecretKey) throw new BillingNotConfiguredError();
  stripeClient ??= new Stripe(env.stripeSecretKey);
  return stripeClient;
}

export function resolvePlanFromPrice(priceId: string | undefined): PlanId | null {
  if (priceId && (priceId === env.stripePricePro || priceId === env.stripePriceProAnnual)) {
    return "pro";
  }
  return null;
}

export type CheckoutInput = {
  teamId: string;
  teamName: string;
  email: string;
  planId: PlanId;
  customerId: string | null;
};

export async function createCheckoutSession(
  input: CheckoutInput,
  interval: SubscriptionInterval = "month",
): Promise<{ url: string }> {
  const stripe = getStripe();
  const price = interval === "year" ? env.stripePriceProAnnual : env.stripePricePro;
  if (!price) throw new BillingNotConfiguredError();

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [
      {
        price,
        quantity: 1,
      },
    ],
    // Stripe Tax (plan 16): btw wordt bepaald via de price-configuratie
    // (tax_behavior = exclusive in het Stripe-dashboard) + klantadres.
    automatic_tax: { enabled: true },
    metadata: { team_id: input.teamId, plan_id: input.planId, interval },
    subscription_data: {
      metadata: { team_id: input.teamId, plan_id: input.planId, interval },
    },
    success_url: `${env.appUrl}/billing?checkout=success`,
    cancel_url: `${env.appUrl}/pricing?checkout=canceled`,
  };
  if (input.customerId) {
    params.customer = input.customerId;
    params.customer_update = { address: "auto" };
  } else {
    // Nieuwe klant: altijd een Stripe-customer aanmaken (vereist voor Tax).
    params.customer_creation = "always";
    params.customer_email = input.email;
  }

  const session = await stripe.checkout.sessions.create(params);
  return { url: session.url ?? `${env.appUrl}/pricing` };
}

export async function createPortalSession(customerId: string): Promise<{ url: string }> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.appUrl}/billing`,
  });
  return { url: session.url };
}

export function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Stripe.Event {
  if (!env.stripeWebhookSecret) throw new BillingNotConfiguredError();
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
}

const INVOICE_STATUSES = new Set(["paid", "open", "void", "uncollectible", "draft", "past_due"]);

type InvoiceView = {
  id: string;
  number: string;
  status: string;
  created_at: string;
  subtotal: number;
  tax_total: number;
  total: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  pdf_url: string | null;
  hosted_url: string | null;
};

/**
 * Facturen live uit de Stripe-API (plan 16, besluit 1): geen lokale tabel,
 * Stripe blijft single source of truth. Max 12 maanden terug, desc.
 */
export async function listInvoices(customerId: string): Promise<InvoiceView[]> {
  const stripe = getStripe();
  const since = Math.floor((Date.now() - 365 * 24 * 3600 * 1000) / 1000);

  const result = await stripe.invoices.list({ customer: customerId, limit: 100 });
  return result.data
    .filter((invoice) => invoice.created >= since)
    .sort((a, b) => b.created - a.created)
    .map((invoice) => ({
      id: invoice.id,
      number: invoice.number ?? invoice.id,
      status: invoice.status && INVOICE_STATUSES.has(invoice.status) ? invoice.status : "draft",
      created_at: new Date(invoice.created * 1000).toISOString(),
      subtotal: invoice.subtotal ?? 0,
      tax_total: Math.max(
        0,
        (invoice.total ?? 0) - (invoice.total_excluding_tax ?? invoice.subtotal ?? 0),
      ),
      total: invoice.total ?? 0,
      currency: invoice.currency,
      period_start: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : null,
      period_end: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
      pdf_url: invoice.invoice_pdf ?? null,
      hosted_url: invoice.hosted_invoice_url ?? null,
    }));
}

export type PaymentMethodView = {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
} | null;

export type SubscriptionView = {
  plan: PlanId;
  status: SubscriptionStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  interval: SubscriptionInterval;
  default_payment_method: PaymentMethodView;
};

/**
 * Abonnements-view voor de UI (plan 16): DB-rij + max 1 live Stripe-call
 * voor de betaalmethode/actuele interval (acceptatiecriterium: geen Stripe-
 * call per render; alleen op deze GET). Zonder abonnement → free-view.
 */
export async function getSubscriptionView(
  db: Pool,
  teamId: string,
): Promise<SubscriptionView> {
  const state = await getSubscriptionState(db, teamId);
  if (!state || !state.stripe_subscription_id) {
    return {
      plan: "free",
      status: "active",
      current_period_end: null,
      cancel_at_period_end: false,
      interval: "month",
      default_payment_method: null,
    };
  }

  let live: Awaited<ReturnType<typeof getStripeSubscription>> | null = null;
  try {
    live = await getStripeSubscription(state.stripe_subscription_id);
  } catch (err) {
    console.error("live subscription ophalen mislukt:", err);
  }

  return {
    plan: state.plan,
    status: state.status as SubscriptionStatus,
    current_period_end: state.current_period_end?.toISOString() ?? null,
    cancel_at_period_end: live?.cancel_at_period_end ?? state.cancel_at_period_end,
    interval: live?.interval ?? state.interval,
    default_payment_method: live?.default_payment_method ?? null,
  };
}

/** Abonnement uit Stripe (live) + betaalmethode (plan 16, besluit: live,
 *  geen payment_method-webhook-sync). */
export async function getStripeSubscription(
  subscriptionId: string,
): Promise<{
  status: string;
  cancel_at_period_end: boolean;
  interval: SubscriptionInterval;
  default_payment_method: PaymentMethodView;
}> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  });

  const pm =
    subscription.default_payment_method &&
    typeof subscription.default_payment_method !== "string" &&
    "card" in subscription.default_payment_method &&
    subscription.default_payment_method.card
      ? {
          brand: subscription.default_payment_method.card.brand,
          last4: subscription.default_payment_method.card.last4,
          exp_month: subscription.default_payment_method.card.exp_month,
          exp_year: subscription.default_payment_method.card.exp_year,
        }
      : null;

  const interval =
    subscription.items.data[0]?.price?.recurring?.interval === "year"
      ? "year"
      : "month";

  return {
    status: subscription.status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    interval,
    default_payment_method: pm,
  };
}

/** Opzeggen: toegang tot einde periode (plan 16, besluit 3). */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

/** Hervatten: opzegging ongedaan maken (geen nieuwe checkout nodig). */
export async function reactivateSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}

/** Plan-wissel maand↔jaar via de items-price (met pro-rating). */
export async function switchSubscriptionInterval(
  subscriptionId: string,
  interval: SubscriptionInterval,
): Promise<void> {
  const stripe = getStripe();
  const price = interval === "year" ? env.stripePriceProAnnual : env.stripePricePro;
  if (!price) throw new BillingNotConfiguredError();

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) throw new Error("Geen abonnementsregel gevonden");

  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price }],
    proration_behavior: "create_prorations",
  });
}
