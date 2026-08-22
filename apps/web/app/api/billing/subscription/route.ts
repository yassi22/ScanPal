import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { subscriptionResponseSchema } from "@scanpal/shared";
import { requireTeam, requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getSubscriptionState } from "@/lib/credits";
import {
  getSubscriptionView,
  reactivateSubscription,
  switchSubscriptionInterval,
  cancelSubscription,
  BillingNotConfiguredError,
} from "@/lib/billing";
import { subscriptionUpdateSchema } from "@scanpal/shared";

export const runtime = "nodejs";

function toError(status: number, message: string, retryAfter?: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} },
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return toError(auth.status, auth.status === 429 ? "Rate limit bereikt" : "Unauthorized", auth.retryAfter);
  }

  const view = await getSubscriptionView(pool, auth.ctx.teamId);
  const parsed = subscriptionResponseSchema.safeParse({ subscription: view });
  if (!parsed.success) {
    console.error("abonnement voldoet niet aan het contract:", parsed.error);
    return toError(500, "Abonnement is niet beschikbaar");
  }
  return NextResponse.json(parsed.data);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSessionOwner();
  if (!auth.ok) {
    return toError(auth.status, auth.status === 403 ? "Alleen de eigenaar" : "Unauthorized");
  }

  const body = await request.json().catch(() => null);
  const parsed = subscriptionUpdateSchema.safeParse(body ?? {});
  if (!parsed.success || (parsed.data.interval === undefined && parsed.data.reactivate !== true)) {
    return toError(400, "Invalid change (interval or reactivate)");
  }

  const subscription = await getSubscriptionState(pool, auth.ctx.teamId);
  if (!subscription?.stripe_subscription_id) {
    return toError(404, "No subscription to modify");
  }

  try {
    if (parsed.data.interval) {
      await switchSubscriptionInterval(
        subscription.stripe_subscription_id,
        parsed.data.interval,
        subscription.plan,
      );
    }
    if (parsed.data.reactivate) {
      await reactivateSubscription(subscription.stripe_subscription_id);
    }

    const view = await getSubscriptionView(pool, auth.ctx.teamId);
    const response = subscriptionResponseSchema.safeParse({ subscription: view });
    if (!response.success) {
      return toError(500, "Abonnement is niet beschikbaar");
    }
    return NextResponse.json(response.data);
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return toError(503, "Betalingen zijn nog niet geconfigureerd");
    }
    console.error("abonnement wijzigen mislukt:", err);
    return toError(500, "Abonnement wijzigen mislukt. Probeer het opnieuw.");
  }
}

export async function DELETE() {
  const auth = await requireSessionOwner();
  if (!auth.ok) {
    return toError(auth.status, auth.status === 403 ? "Alleen de eigenaar" : "Unauthorized");
  }

  const subscription = await getSubscriptionState(pool, auth.ctx.teamId);
  if (!subscription?.stripe_subscription_id) {
    return toError(404, "No subscription to cancel");
  }

  try {
    await cancelSubscription(subscription.stripe_subscription_id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return toError(503, "Betalingen zijn nog niet geconfigureerd");
    }
    console.error("opzeggen mislukt:", err);
    return toError(500, "Opzeggen mislukt. Probeer het opnieuw.");
  }
}
