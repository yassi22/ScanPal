import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { webhookCreatedSchema } from "@scanpal/shared";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import {
  rotateWebhookSecret,
  WebhookNotConfiguredError,
} from "@/lib/webhooks-core";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/[id]/secret — secret-rotatie (oud secret wordt direct
 * ongeldig; nieuw secret 1× zichtbaar). Owner-only (besluit plan 15).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionOwner();
  if (!auth.ok) {
    return NextResponse.json(
      {
        error:
          auth.status === 403
            ? "Alleen de team-owner kan het webhook-secret roteren"
            : "Unauthorized",
      },
      { status: auth.status },
    );
  }

  const { id } = await params;
  try {
    const result = await rotateWebhookSecret(pool, {
      teamId: auth.ctx.teamId,
      webhookId: id,
      secretKey: env.webhookSecretKey ?? "",
    });
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const response = webhookCreatedSchema.safeParse({
      webhook: result.view,
      secret: result.secret,
    });
    if (!response.success) {
      console.error("geroteerde webhook voldoet niet aan het contract:", response.error);
      return NextResponse.json(
        { error: "Roteren mislukt. Probeer het opnieuw." },
        { status: 500 },
      );
    }
    return NextResponse.json(response.data);
  } catch (err) {
    if (err instanceof WebhookNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("secret-rotatie mislukt:", err);
    return NextResponse.json(
      { error: "Roteren mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
