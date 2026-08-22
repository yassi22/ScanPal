import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { invoiceViewSchema, invoicesListResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getSubscriptionState } from "@/lib/credits";
import { listInvoices, BillingNotConfiguredError } from "@/lib/billing";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 429 ? "Rate limit bereikt" : "Unauthorized" },
      { status: auth.status, headers: auth.retryAfter ? { "Retry-After": String(auth.retryAfter) } : {} },
    );
  }

  const subscription = await getSubscriptionState(pool, auth.ctx.teamId);
  if (!subscription?.stripe_customer_id) {
    // Geen klant bij Stripe (free): geen facturen — geen data-lek.
    return NextResponse.json({ error: "No invoices" }, { status: 404 });
  }

  try {
    const invoices = await listInvoices(subscription.stripe_customer_id);
    const parsed = invoicesListResponseSchema.safeParse({
      invoices: invoices.map((invoice) => invoiceViewSchema.parse(invoice)),
    });
    if (!parsed.success) {
      console.error("facturen voldoen niet aan het contract:", parsed.error);
      return NextResponse.json(
        { error: "Facturen zijn niet beschikbaar" },
        { status: 500 },
      );
    }
    return NextResponse.json(parsed.data);
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return NextResponse.json(
        { error: "Betalingen zijn nog niet geconfigureerd" },
        { status: 503 },
      );
    }
    console.error("facturen ophalen mislukt:", err);
    return NextResponse.json(
      { error: "Facturen ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
