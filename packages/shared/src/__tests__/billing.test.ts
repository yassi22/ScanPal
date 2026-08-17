import { describe, it, expect } from "vitest";
import {
  billingCheckoutSchema,
  invoiceViewSchema,
  invoicesListResponseSchema,
  subscriptionViewSchema,
  subscriptionResponseSchema,
  subscriptionIntervalSchema,
} from "../billing";

describe("billing schemas (plan 16)", () => {
  it("checkout: interval default maand", () => {
    const parsed = billingCheckoutSchema.safeParse({ planId: "pro" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("parse mislukt");
    expect(parsed.data.interval).toBe("month");
  });

  it("checkout: accepteert jaar-interval en weigert onbekende", () => {
    expect(
      billingCheckoutSchema.safeParse({ planId: "pro", interval: "year" }).success,
    ).toBe(true);
    expect(
      billingCheckoutSchema.safeParse({ planId: "pro", interval: "decade" }).success,
    ).toBe(false);
    expect(billingCheckoutSchema.safeParse({ planId: "free" }).success).toBe(true);
  });

  it("valideert een invoice-view", () => {
    const parsed = invoiceViewSchema.safeParse({
      id: "in_1",
      number: "INV-2026-001",
      status: "paid",
      created_at: "2026-08-16T09:00:00.000Z",
      subtotal: 2400,
      tax_total: 504,
      total: 2904,
      currency: "eur",
      period_start: "2026-07-16T09:00:00.000Z",
      period_end: "2026-08-16T09:00:00.000Z",
      pdf_url: "https://pay.stripe.com/invoice/in_1/pdf",
      hosted_url: "https://pay.stripe.com/invoice/in_1",
    });
    expect(parsed.success).toBe(true);
  });

  it("weigert een invoice-view met negatief totaal", () => {
    expect(
      invoiceViewSchema.safeParse({
        id: "in_1",
        number: "INV-2026-001",
        status: "paid",
        created_at: "2026-08-16T09:00:00.000Z",
        subtotal: 2400,
        tax_total: 504,
        total: -1,
        currency: "eur",
        period_start: null,
        period_end: null,
        pdf_url: null,
        hosted_url: null,
      }).success,
    ).toBe(false);
  });

  it("valideert een subscription-view met betaalmethode", () => {
    const parsed = subscriptionViewSchema.safeParse({
      plan: "pro",
      status: "active",
      current_period_end: "2026-09-16T09:00:00.000Z",
      cancel_at_period_end: false,
      interval: "year",
      default_payment_method: {
        brand: "visa",
        last4: "4242",
        exp_month: 12,
        exp_year: 2029,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("subscription-view: interval valide, onbekend geweigerd", () => {
    expect(subscriptionIntervalSchema.safeParse("month").success).toBe(true);
    expect(subscriptionIntervalSchema.safeParse("week").success).toBe(false);
  });

  it("invoices-lijst response", () => {
    const parsed = invoicesListResponseSchema.safeParse({
      invoices: [
        {
          id: "in_1",
          number: "INV-1",
          status: "open",
          created_at: "2026-08-16T09:00:00.000Z",
          subtotal: 0,
          tax_total: 0,
          total: 2900,
          currency: "eur",
          period_start: null,
          period_end: null,
          pdf_url: null,
          hosted_url: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("subscription-response wrapper", () => {
    const parsed = subscriptionResponseSchema.safeParse({
      subscription: {
        plan: "free",
        status: "active",
        current_period_end: null,
        cancel_at_period_end: false,
        interval: "month",
        default_payment_method: null,
      },
    });
    expect(parsed.success).toBe(true);
  });
});
