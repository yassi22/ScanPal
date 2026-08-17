import { NextResponse } from "next/server";
import {
  webhookCreateSchema,
  webhookCreatedSchema,
  webhookListResponseSchema,
} from "@scanpal/shared";
import { requireSessionTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { getPlanForTeam } from "@/lib/credits";
import {
  createWebhook,
  listWebhooks,
  WebhookLimitError,
  WebhookNotConfiguredError,
  WebhookUrlError,
} from "@/lib/webhooks-core";

export const runtime = "nodejs";

function toError(err: unknown) {
  if (err instanceof WebhookNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof WebhookLimitError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof WebhookUrlError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("webhook-fout:", err);
  return NextResponse.json(
    { error: "Verwerken mislukt. Probeer het opnieuw." },
    { status: 500 },
  );
}

function authError(status: 401) {
  return NextResponse.json({ error: "Unauthorized" }, { status });
}

/**
 * GET /api/webhooks — lijst (zonder secret). Teamlid, sessie-only
 * (géén bearer keys — contract plan 14/15).
 */
export async function GET() {
  const auth = await requireSessionTeam();
  if (!auth.ok) return authError(auth.status);

  const webhooks = await listWebhooks(pool, auth.ctx.teamId);
  const parsed = webhookListResponseSchema.safeParse({ webhooks });
  if (!parsed.success) {
    console.error("webhook-lijst voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}

/**
 * POST /api/webhooks — create; het secret is 1× zichtbaar in de response
 * (DB slaat alleen de AES-GCM-versleuteling op). Teamlid.
 */
export async function POST(request: Request) {
  const auth = await requireSessionTeam();
  if (!auth.ok) return authError(auth.status);

  const body = await request.json().catch(() => null);
  const parsed = webhookCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  try {
    const plan = await getPlanForTeam(pool, auth.ctx.teamId);
    const { view, secret } = await createWebhook(pool, {
      teamId: auth.ctx.teamId,
      createdBy: auth.ctx.userId,
      name: parsed.data.name,
      url: parsed.data.url,
      events: parsed.data.events,
      secretKey: env.webhookSecretKey ?? "",
      maxWebhooks: plan.maxWebhooks,
    });

    const response = webhookCreatedSchema.safeParse({ webhook: view, secret });
    if (!response.success) {
      console.error("aangemaakte webhook voldoet niet aan het contract:", response.error);
      return NextResponse.json(
        { error: "Aanmaken mislukt. Probeer het opnieuw." },
        { status: 500 },
      );
    }
    return NextResponse.json(response.data, { status: 201 });
  } catch (err) {
    return toError(err);
  }
}
