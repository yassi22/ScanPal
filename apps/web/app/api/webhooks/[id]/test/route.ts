import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { webhookTestResponseSchema } from "@scanpal/shared";
import { requireSessionTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import {
  sendTestWebhook,
  WebhookNotConfiguredError,
} from "@/lib/webhooks-core";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/[id]/test — directe test-delivery (event `test`).
 * De webapp voert hier dezelfde deliverer-code uit als de scheduler-loop;
 * een mislukte test telt niet mee voor retries/disable (plan 15).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionTeam();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const result = await sendTestWebhook(pool, {
      teamId: auth.ctx.teamId,
      webhookId: id,
      secretKey: env.webhookSecretKey ?? "",
    });
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const response = webhookTestResponseSchema.safeParse(result);
    if (!response.success) {
      console.error("test-delivery voldoet niet aan het contract:", response.error);
      return NextResponse.json(
        { error: "Test-delivery mislukt. Probeer het opnieuw." },
        { status: 500 },
      );
    }
    return NextResponse.json(response.data);
  } catch (err) {
    if (err instanceof WebhookNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("test-delivery mislukt:", err);
    return NextResponse.json(
      { error: "Test-delivery mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
