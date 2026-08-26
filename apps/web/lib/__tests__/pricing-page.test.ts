import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PricingPage from "@/app/pricing/page";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null } })),
    },
  })),
}));

describe("PricingPage", () => {
  it("renders the public comparison and canceled-checkout state", async () => {
    const html = renderToStaticMarkup(
      await PricingPage({ searchParams: Promise.resolve({ checkout: "canceled" }) }),
    );

    expect(html).toContain("Simpele prijzen, geen verrassingen");
    expect(html).toContain("Checkout geannuleerd");
    expect(html).toContain("Free");
    expect(html).toContain("Pro");
    expect(html).toContain("Max");
  });
});
