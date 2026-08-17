import { z } from "zod";
import { planIdSchema } from "./plans";
import { subscriptionStatusSchema } from "./plans";

export const subscriptionIntervalSchema = z.enum(["month", "year"]);
export type SubscriptionInterval = z.infer<typeof subscriptionIntervalSchema>;

/** Checkout-body (plan 16): interval bepaalt welke Stripe price wordt gebruikt. */
export const billingCheckoutSchema = z.object({
  planId: planIdSchema,
  interval: subscriptionIntervalSchema.optional().default("month"),
});
export type BillingCheckout = z.infer<typeof billingCheckoutSchema>;

const invoiceStatusSchema = z.enum([
  "paid",
  "open",
  "void",
  "uncollectible",
  "draft",
  "past_due",
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Live uit de Stripe-API gepind (geen lokale tabel), zonder gevoelige data. */
export const invoiceViewSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: invoiceStatusSchema,
  created_at: z.string().datetime(),
  subtotal: z.number().int().nonnegative(),
  tax_total: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  currency: z.string(),
  period_start: z.string().datetime().nullable(),
  period_end: z.string().datetime().nullable(),
  pdf_url: z.string().nullable(),
  hosted_url: z.string().nullable(),
});
export type InvoiceView = z.infer<typeof invoiceViewSchema>;

export const invoicesListResponseSchema = z.object({
  invoices: z.array(invoiceViewSchema),
});
export type InvoicesListResponse = z.infer<typeof invoicesListResponseSchema>;

/** DB-rij (interval/cancel_at_period_end) + live betaalmethode uit Stripe. */
export const subscriptionViewSchema = z.object({
  plan: planIdSchema,
  status: subscriptionStatusSchema,
  current_period_end: z.string().datetime().nullable(),
  cancel_at_period_end: z.boolean(),
  interval: subscriptionIntervalSchema,
  default_payment_method: z
    .object({
      brand: z.string(),
      last4: z.string(),
      exp_month: z.number().int().min(1).max(12),
      exp_year: z.number().int(),
    })
    .nullable(),
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;

export const subscriptionResponseSchema = z.object({
  subscription: subscriptionViewSchema,
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

/** PATCH /api/billing/subscription (owner): interval-wissel en/of reactivate. */
export const subscriptionUpdateSchema = z.object({
  interval: subscriptionIntervalSchema.optional(),
  reactivate: z.boolean().optional(),
});
export type SubscriptionUpdate = z.infer<typeof subscriptionUpdateSchema>;
