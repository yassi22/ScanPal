import { NextResponse } from "next/server";
import { billingCheckoutSchema } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { getOrCreateUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getSubscriptionState } from "@/lib/credits";
import { createCheckoutSession, BillingNotConfiguredError } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = billingCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  if (parsed.data.planId === "free") {
    return NextResponse.json(
      { error: "The Free plan does not require checkout" },
      { status: 400 },
    );
  }

  const { team, membership } = await getOrCreateUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only the owner can manage subscriptions" },
      { status: 403 },
    );
  }

  const subscription = await getSubscriptionState(pool, team.id);

  try {
    const { url } = await createCheckoutSession(
      {
        teamId: team.id,
        teamName: team.name,
        email: user.email ?? "",
        planId: parsed.data.planId,
        customerId: subscription?.stripe_customer_id ?? null,
      },
      parsed.data.interval,
    );
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return NextResponse.json(
        { error: "Payments are not configured yet" },
        { status: 503 },
      );
    }
    console.error("checkout failed:", err);
    return NextResponse.json(
      { error: "Failed to start checkout. Please try again." },
      { status: 500 },
    );
  }
}
