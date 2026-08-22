import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { constructWebhookEvent, resolvePlanFromPrice, BillingNotConfiguredError } from "@/lib/billing";
import { processStripeEvent, findTeamIdByStripeCustomer } from "@/lib/billing-core";
import type { StripeWebhookEvent } from "@/lib/billing-core";
import { notifier } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      console.error(
        "stripe-webhook geweigerd: STRIPE_WEBHOOK_SECRET ontbreekt (Stripe niet geconfigureerd)",
      );
      return NextResponse.json(
        { error: "Stripe is niet geconfigureerd" },
        { status: 503 },
      );
    }
    // Meestal een verlopen/verkeerde STRIPE_WEBHOOK_SECRET (verandert per
    // `stripe listen`-sessie). Zonder deze log faalt dit stil met een 400 en
    // wordt er nooit een event verwerkt — dan blijft een betaald team op free.
    console.error(
      "stripe-webhook handtekening ongeldig — controleer STRIPE_WEBHOOK_SECRET:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await processStripeEvent(
      pool,
      event as unknown as StripeWebhookEvent,
      resolvePlanFromPrice,
    );

    // Plan 16: betalingsfout → hub-notificatie (in-app + mail). Alleen bij de
    // eerste verwerking van dit event (outcome != duplicate); de notify-dedup
    // (invoice-id als entityId) is de backstop voor dunning-retries.
    if (event.type === "invoice.payment_failed" && outcome === "processed") {
      const invoice = event.data.object;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : null;
      const teamId = await findTeamIdByStripeCustomer(pool, customerId);
      if (teamId) {
        const amountCents = typeof invoice.amount_due === "number" ? invoice.amount_due : null;
        await notifier({
          type: "payment_failed",
          teamId,
          entityId: invoice.id ?? "unknown-invoice",
          payload: {
            amount_due: amountCents !== null ? `€${(amountCents / 100).toFixed(2)}` : null,
            invoice_id: invoice.id ?? null,
          },
        });
      }
    }

    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    console.error("webhook verwerking mislukt:", err);
    return NextResponse.json(
      { error: "Webhook verwerking mislukt" },
      { status: 500 },
    );
  }
}
