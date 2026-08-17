import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getSubscriptionState } from "@/lib/credits";
import { createPortalSession, BillingNotConfiguredError } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { team } = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  const subscription = await getSubscriptionState(pool, team.id);
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
