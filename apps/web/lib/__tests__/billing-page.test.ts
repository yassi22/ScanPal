import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BillingPage from "@/app/(dashboard)/billing/page";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/db", () => ({ pool: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: "user-1",
            email: "owner@example.com",
            user_metadata: {},
            app_metadata: {},
          },
        },
      })),
    },
  })),
}));
vi.mock("@/lib/team", () => ({
  ensureUserTeam: vi.fn(async () => ({
    team: { id: "team-1", name: "Acme Studio" },
    membership: { role: "owner" },
  })),
}));
vi.mock("@/lib/credits", () => ({
  getTeamUsage: vi.fn(async () => ({
    plan: { id: "pro" },
    creditsUsed: 18,
    creditsLimit: 100,
    resetAt: "2026-09-19T00:00:00.000Z",
  })),
}));
vi.mock("@/lib/billing", () => ({
  getSubscriptionView: vi.fn(async () => ({
    plan: "pro",
    status: "active",
    current_period_end: "2026-09-19T00:00:00.000Z",
    cancel_at_period_end: false,
    interval: "month",
    default_payment_method: {
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2029,
    },
  })),
}));

describe("BillingPage", () => {
  it("renders all named client components across the server boundary", async () => {
    const html = renderToStaticMarkup(await BillingPage());

    expect(html).toContain("Plan, usage, and payment in one place.");
    expect(html).toContain("Manage subscription");
    expect(html).toContain("Invoices");
  });
});
