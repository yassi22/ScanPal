import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  invoicesList: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("stripe", () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mocks.sessionsCreate } };
    billingPortal = { sessions: { create: vi.fn() } };
    invoices = { list: mocks.invoicesList };
    subscriptions = {
      retrieve: mocks.subscriptionsRetrieve,
      update: mocks.subscriptionsUpdate,
    };
    webhooks = { constructEvent: vi.fn() };
  },
}));
vi.mock("@/lib/env", () => ({
  env: {
    stripeSecretKey: "sk_test_1",
    stripeWebhookSecret: "whsec_1",
    stripePricePro: "price_pro_month",
    stripePriceProAnnual: "price_pro_year",
    stripePriceMax: "price_max_month",
    stripePriceMaxAnnual: "price_max_year",
    appUrl: "http://localhost:3000",
  },
}));

import {
  createCheckoutSession,
  getStripeSubscription,
  cancelSubscription,
  reactivateSubscription,
  switchSubscriptionInterval,
  listInvoices,
  resolvePlanFromPrice,
} from "@/lib/billing";

const monthInSeconds = 30 * 24 * 3600;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePlanFromPrice", () => {
  it("mapped maand- én jaarprice naar pro én max", () => {
    expect(resolvePlanFromPrice("price_pro_month")).toBe("pro");
    expect(resolvePlanFromPrice("price_pro_year")).toBe("pro");
    expect(resolvePlanFromPrice("price_max_month")).toBe("max");
    expect(resolvePlanFromPrice("price_max_year")).toBe("max");
    expect(resolvePlanFromPrice("price_other")).toBeNull();
    expect(resolvePlanFromPrice(undefined)).toBeNull();
  });
});

describe("createCheckoutSession", () => {
  it("maand-abonnement met Stripe Tax (exclusief), nieuwe klant", async () => {
    mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

    const result = await createCheckoutSession({
      teamId: "team-1",
      teamName: "Team",
      email: "a@b.nl",
      planId: "pro",
      customerId: null,
    });

    expect(result.url).toBe("https://checkout.stripe.com/x");
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.mode).toBe("subscription");
    expect(params.line_items[0].price).toBe("price_pro_month");
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.customer_creation).toBe("always");
    expect(params.customer_email).toBe("a@b.nl");
    expect(params.customer).toBeUndefined();
    expect(params.subscription_data.metadata).toMatchObject({
      team_id: "team-1",
      interval: "month",
    });
  });

  it("jaar-abonnement met bestaande klant", async () => {
    mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/y" });

    await createCheckoutSession(
      { teamId: "team-1", teamName: "Team", email: "a@b.nl", planId: "pro", customerId: "cus_1" },
      "year",
    );

    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.line_items[0].price).toBe("price_pro_year");
    expect(params.customer).toBe("cus_1");
    expect(params.customer_update).toEqual({ address: "auto" });
    expect(params.customer_creation).toBeUndefined();
  });

  it("gebruikt de max-price (maand én jaar) bij planId max", async () => {
    mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/mx" });

    await createCheckoutSession(
      { teamId: "team-1", teamName: "Team", email: "a@b.nl", planId: "max", customerId: null },
      "month",
    );
    await createCheckoutSession(
      { teamId: "team-1", teamName: "Team", email: "a@b.nl", planId: "max", customerId: null },
      "year",
    );

    const monthParams = mocks.sessionsCreate.mock.calls[0][0];
    expect(monthParams.line_items[0].price).toBe("price_max_month");
    expect(monthParams.metadata).toMatchObject({ plan_id: "max", interval: "month" });

    const yearParams = mocks.sessionsCreate.mock.calls[1][0];
    expect(yearParams.line_items[0].price).toBe("price_max_year");
    expect(yearParams.metadata).toMatchObject({ plan_id: "max", interval: "year" });
  });

  it("gooit BillingNotConfiguredError als de jaarlijkse price ontbreekt", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { stripeSecretKey: "sk_test_1", stripePricePro: "p1", appUrl: "http://x" },
    }));
    vi.doMock("server-only", () => ({}));
    const billing = await import("@/lib/billing");
    await expect(
      billing.createCheckoutSession(
        { teamId: "t", teamName: "T", email: "e", planId: "pro", customerId: null },
        "year",
      ),
    ).rejects.toThrow("Stripe is niet geconfigureerd");
  });
});

describe("listInvoices", () => {
  it("levert facturen desc, gefilterd op 12 maanden", async () => {
    const now = Math.floor(Date.now() / 1000);
    mocks.invoicesList.mockResolvedValue({
      data: [
        { id: "in_old", created: now - 400 * 24 * 3600, number: "INV-0", status: "paid", subtotal: 100, tax: 21, total: 121, currency: "eur", period_start: null, period_end: null, invoice_pdf: null, hosted_invoice_url: null },
        { id: "in_new", created: now - 100, number: "INV-2", status: "paid", subtotal: 2400, tax: 504, total: 2904, currency: "eur", period_start: now - monthInSeconds, period_end: now, invoice_pdf: "https://pay.stripe.com/invoice/in_new/pdf", hosted_invoice_url: "https://pay.stripe.com/invoice/in_new" },
        { id: "in_open", created: now - 200, number: "INV-1", status: "open", subtotal: 2400, tax: 504, total: 2904, currency: "eur", period_start: null, period_end: null, invoice_pdf: null, hosted_invoice_url: null },
      ],
    });

    const invoices = await listInvoices("cus_1");

    expect(mocks.invoicesList).toHaveBeenCalledWith({
      customer: "cus_1",
      limit: 100,
    });
    expect(invoices.map((i) => i.id)).toEqual(["in_new", "in_open"]);
    expect(invoices[0].status).toBe("paid");
    expect(invoices[0].pdf_url).toBe("https://pay.stripe.com/invoice/in_new/pdf");
    expect(invoices[0].period_end).toBe(new Date(now * 1000).toISOString());
  });

  it("valt terug op draft-status bij onbekende status", async () => {
    mocks.invoicesList.mockResolvedValue({
      data: [{ id: "in_x", created: Math.floor(Date.now() / 1000), number: null, status: "weird", subtotal: 0, tax: 0, total: 0, currency: "eur" }],
    });
    const invoices = await listInvoices("cus_1");
    expect(invoices[0].number).toBe("in_x");
    expect(invoices[0].status).toBe("draft");
  });
});

describe("getStripeSubscription", () => {
  it("parsert betaalmethode en interval", async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue({
      status: "active",
      cancel_at_period_end: true,
      default_payment_method: {
        card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2029 },
      },
      items: { data: [{ price: { recurring: { interval: "year" } } }] },
    });

    const result = await getStripeSubscription("sub_1");

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_1", {
      expand: ["default_payment_method"],
    });
    expect(result).toEqual({
      status: "active",
      cancel_at_period_end: true,
      interval: "year",
      default_payment_method: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2029 },
    });
  });

  it("geeft null betaalmethode bij string-id (niet geëxpand)", async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue({
      status: "active",
      cancel_at_period_end: false,
      default_payment_method: "pm_1",
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });

    const result = await getStripeSubscription("sub_1");
    expect(result.default_payment_method).toBeNull();
    expect(result.interval).toBe("month");
  });
});

describe("cancel / reactivate / switch", () => {
  it("cancelSubscription zet cancel_at_period_end", async () => {
    await cancelSubscription("sub_1");
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
  });

  it("reactivateSubscription maakt het ongedaan", async () => {
    await reactivateSubscription("sub_1");
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
  });

  it("switchSubscriptionInterval wisselt de items-price met pro-rating", async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: "si_1" }] },
    });

    await switchSubscriptionInterval("sub_1", "year", "pro");

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_1");
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_pro_year" }],
      proration_behavior: "create_prorations",
    });
  });

  it("switchSubscriptionInterval gebruikt de max-prices voor het max-plan", async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: "si_1" }] },
    });

    await switchSubscriptionInterval("sub_1", "year", "max");
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_max_year" }],
      proration_behavior: "create_prorations",
    });

    await switchSubscriptionInterval("sub_1", "month", "max");
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_max_month" }],
      proration_behavior: "create_prorations",
    });
  });
});
