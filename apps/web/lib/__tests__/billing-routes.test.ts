import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as invoicesGET } from "@/app/api/billing/invoices/route";
import {
  GET as subGET,
  PATCH as subPATCH,
  DELETE as subDELETE,
} from "@/app/api/billing/subscription/route";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { POST as portalPOST } from "@/app/api/billing/portal/route";
import { requireTeam, requireSessionOwner } from "@/lib/api-auth";
import { getSubscriptionState } from "@/lib/credits";
import {
  listInvoices,
  getSubscriptionView,
  cancelSubscription,
  reactivateSubscription,
  switchSubscriptionInterval,
  createCheckoutSession,
  createPortalSession,
  BillingNotConfiguredError,
} from "@/lib/billing";
import { getSessionUser } from "@/lib/supabase/server";
import { getOrCreateUserTeam } from "@/lib/team";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/api-auth", () => ({
  requireTeam: vi.fn(),
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/credits", () => ({ getSubscriptionState: vi.fn() }));
vi.mock("@/lib/billing", () => ({
  listInvoices: vi.fn(),
  getSubscriptionView: vi.fn(),
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  switchSubscriptionInterval: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  BillingNotConfiguredError: class extends Error {},
}));
vi.mock("@/lib/notify", () => ({ notifier: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/team", () => ({
  getOrCreateUserTeam: vi.fn(),
}));

const requireTeamMock = vi.mocked(requireTeam);
const requireOwnerMock = vi.mocked(requireSessionOwner);
const getSubMock = vi.mocked(getSubscriptionState);
const listInvoicesMock = vi.mocked(listInvoices);
const getViewMock = vi.mocked(getSubscriptionView);
const cancelMock = vi.mocked(cancelSubscription);
const reactivateMock = vi.mocked(reactivateSubscription);
const switchMock = vi.mocked(switchSubscriptionInterval);
const checkoutMock = vi.mocked(createCheckoutSession);
const portalMock = vi.mocked(createPortalSession);
const getSessionMock = vi.mocked(getSessionUser);
const ensureTeamMock = vi.mocked(getOrCreateUserTeam);

const TEAM_ID = "00000000-0000-4000-8000-0000000000a1";

const PRO_SUB = {
  team_id: TEAM_ID,
  plan: "pro",
  status: "active",
  current_period_end: new Date("2026-09-16T09:00:00Z"),
  credits_used: 10,
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  cancel_at_period_end: false,
  interval: "month",
} as const;

const PRO_VIEW = {
  plan: "pro",
  status: "active",
  current_period_end: "2026-09-16T09:00:00.000Z",
  cancel_at_period_end: false,
  interval: "month",
  default_payment_method: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2029 },
} as const;

const INVOICE = {
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
} as const;

function jsonRequest(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTeamMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: TEAM_ID, auth: { type: "session", userId: "user-1" } },
  } as never);
  requireOwnerMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: TEAM_ID, userId: "user-1" },
  } as never);
});

describe("GET /api/billing/invoices", () => {
  it("401 zonder auth", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await invoicesGET(new NextRequest("http://localhost/api/billing/invoices"));
    expect(response.status).toBe(401);
  });

  it("404 zonder stripe-customer (free)", async () => {
    getSubMock.mockResolvedValue(null as never);
    const response = await invoicesGET(new NextRequest("http://localhost/api/billing/invoices"));
    expect(response.status).toBe(404);
  });

  it("200 met facturenlijst", async () => {
    getSubMock.mockResolvedValue(PRO_SUB as never);
    listInvoicesMock.mockResolvedValue([INVOICE] as never);

    const response = await invoicesGET(new NextRequest("http://localhost/api/billing/invoices"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].number).toBe("INV-2026-001");
    expect(body.invoices[0].total).toBe(2904);
  });

  it("503 als Stripe niet is geconfigureerd", async () => {
    getSubMock.mockResolvedValue(PRO_SUB as never);
    listInvoicesMock.mockRejectedValue(new BillingNotConfiguredError());
    const response = await invoicesGET(new NextRequest("http://localhost/api/billing/invoices"));
    expect(response.status).toBe(503);
  });

  it("500 bij een Stripe-fout", async () => {
    getSubMock.mockResolvedValue(PRO_SUB as never);
    listInvoicesMock.mockRejectedValue(new Error("stripe kapot"));
    const response = await invoicesGET(new NextRequest("http://localhost/api/billing/invoices"));
    expect(response.status).toBe(500);
  });
});

describe("GET /api/billing/subscription", () => {
  it("401 zonder auth", async () => {
    requireTeamMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await subGET(new NextRequest("http://localhost/api/billing/subscription"));
    expect(response.status).toBe(401);
  });

  it("200 free-view zonder abonnement", async () => {
    getViewMock.mockResolvedValue({
      plan: "free",
      status: "active",
      current_period_end: null,
      cancel_at_period_end: false,
      interval: "month",
      default_payment_method: null,
    } as never);

    const response = await subGET(new NextRequest("http://localhost/api/billing/subscription"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subscription.plan).toBe("free");
  });

  it("200 pro-view met betaalmethode", async () => {
    getViewMock.mockResolvedValue(PRO_VIEW as never);
    const response = await subGET(new NextRequest("http://localhost/api/billing/subscription"));
    const body = await response.json();
    expect(body.subscription.default_payment_method.brand).toBe("visa");
    expect(body.subscription.interval).toBe("month");
  });
});

describe("PATCH /api/billing/subscription", () => {
  it("403 voor een member", async () => {
    requireOwnerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await subPATCH(jsonRequest("http://localhost/api/billing/subscription", { reactivate: true }));
    expect(response.status).toBe(403);
  });

  it("400 bij een lege patch", async () => {
    const response = await subPATCH(jsonRequest("http://localhost/api/billing/subscription", {}));
    expect(response.status).toBe(400);
  });

  it("404 zonder abonnement bij Stripe", async () => {
    getSubMock.mockResolvedValue({ ...PRO_SUB, stripe_subscription_id: null } as never);
    const response = await subPATCH(jsonRequest("http://localhost/api/billing/subscription", { interval: "year" }));
    expect(response.status).toBe(404);
  });

  it("200: wisselt naar jaar-interval", async () => {
    getSubMock.mockResolvedValue(PRO_SUB as never);
    getViewMock.mockResolvedValue({ ...PRO_VIEW, interval: "year" } as never);

    const response = await subPATCH(jsonRequest("http://localhost/api/billing/subscription", { interval: "year" }));
    expect(response.status).toBe(200);
    expect(switchMock).toHaveBeenCalledWith("sub_1", "year", "pro");
    const body = await response.json();
    expect(body.subscription.interval).toBe("year");
  });

  it("200: reactivate ongedaan", async () => {
    getSubMock.mockResolvedValue({ ...PRO_SUB, cancel_at_period_end: true } as never);
    getViewMock.mockResolvedValue({ ...PRO_VIEW, cancel_at_period_end: false } as never);

    const response = await subPATCH(jsonRequest("http://localhost/api/billing/subscription", { reactivate: true }));
    expect(response.status).toBe(200);
    expect(reactivateMock).toHaveBeenCalledWith("sub_1");
  });
});

describe("DELETE /api/billing/subscription", () => {
  it("403 voor een member", async () => {
    requireOwnerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await subDELETE();
    expect(response.status).toBe(403);
  });

  it("404 zonder abonnement", async () => {
    getSubMock.mockResolvedValue(null as never);
    const response = await subDELETE();
    expect(response.status).toBe(404);
  });

  it("204: zegt op met cancel_at_period_end", async () => {
    getSubMock.mockResolvedValue(PRO_SUB as never);
    const response = await subDELETE();
    expect(response.status).toBe(204);
    expect(cancelMock).toHaveBeenCalledWith("sub_1");
  });
});

describe("POST /api/billing/portal", () => {
  it("403 voor een member", async () => {
    requireOwnerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await portalPOST();
    expect(response.status).toBe(403);
    expect(getSubMock).not.toHaveBeenCalled();
  });

  it("200 voor de owner van het team", async () => {
    getSubMock.mockResolvedValue(PRO_SUB as never);
    portalMock.mockResolvedValue({ url: "https://billing.stripe.com/session" });
    const response = await portalPOST();
    expect(response.status).toBe(200);
    expect(getSubMock).toHaveBeenCalledWith(expect.anything(), TEAM_ID);
    expect(portalMock).toHaveBeenCalledWith("cus_1");
  });
});

describe("POST /api/billing/checkout", () => {
  it("400 bij een ongeldige interval", async () => {
    getSessionMock.mockResolvedValue({ id: "user-1", email: "a@b.nl" } as never);
    const response = await checkoutPOST(jsonRequest("http://localhost/api/billing/checkout", { planId: "pro", interval: "decade" }));
    expect(response.status).toBe(400);
  });

  it("200: checkout met jaar-interval", async () => {
    getSessionMock.mockResolvedValue({ id: "user-1", email: "a@b.nl" } as never);
    ensureTeamMock.mockResolvedValue({ team: { id: TEAM_ID, name: "Team" }, membership: { role: "owner" } } as never);
    getSubMock.mockResolvedValue(PRO_SUB as never);
    checkoutMock.mockResolvedValue({ url: "https://checkout.stripe.com/y" } as never);

    const response = await checkoutPOST(jsonRequest("http://localhost/api/billing/checkout", { planId: "pro", interval: "year" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://checkout.stripe.com/y");
    expect(checkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, planId: "pro" }),
      "year",
    );
  });

  it("200: checkout met het max-plan", async () => {
    getSessionMock.mockResolvedValue({ id: "user-1", email: "a@b.nl" } as never);
    ensureTeamMock.mockResolvedValue({ team: { id: TEAM_ID, name: "Team" }, membership: { role: "owner" } } as never);
    getSubMock.mockResolvedValue(PRO_SUB as never);
    checkoutMock.mockResolvedValue({ url: "https://checkout.stripe.com/mx" } as never);

    const response = await checkoutPOST(jsonRequest("http://localhost/api/billing/checkout", { planId: "max", interval: "month" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://checkout.stripe.com/mx");
    expect(checkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, planId: "max" }),
      "month",
    );
  });

  it("401 zonder sessie", async () => {
    getSessionMock.mockResolvedValue(null as never);
    const response = await checkoutPOST(jsonRequest("http://localhost/api/billing/checkout", { planId: "pro" }));
    expect(response.status).toBe(401);
  });
});
