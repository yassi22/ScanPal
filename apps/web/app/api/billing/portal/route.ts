import { NextResponse } from "next/server";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getSubscriptionState } from "@/lib/credits";
import { createPortalSession, BillingNotConfiguredError } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireSessionOwner();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 403 ? "Alleen de eigenaar" : "Unauthorized" },
      { status: auth.status },
    );
  }

  const subscription = await getSubscriptionState(pool, auth.ctx.teamId);
  if (!subscription?.stripe_customer_id) {
    return NextResponse.json(
      { error: "Er is nog geen abonnement om te beheren" },
      { status: 400 },
    );
  }

  try {
    const { url } = await createPortalSession(subscription.stripe_customer_id);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return NextResponse.json(
        { error: "Betalingen zijn nog niet geconfigureerd" },
        { status: 503 },
      );
    }
    console.error("portal mislukt:", err);
    return NextResponse.json(
      { error: "Portal openen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
