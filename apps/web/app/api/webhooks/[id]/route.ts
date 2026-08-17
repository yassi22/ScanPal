import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { webhookUpdateSchema, webhookViewSchema } from "@scanpal/shared";
import { requireSessionTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteWebhook, updateWebhook, WebhookUrlError } from "@/lib/webhooks-core";

export const runtime = "nodejs";

/**
 * PATCH /api/webhooks/[id] — update (name, url, events, active). Teamlid,
 * sessie-only (géén bearer keys — contract plan 14/15); een webhook van een
 * ander team → 404 (geen existence-leak).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionTeam();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = webhookUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  try {
    const view = await updateWebhook(pool, {
      teamId: auth.ctx.teamId,
      webhookId: id,
      patch: parsed.data,
      secretKey: env.webhookSecretKey ?? "",
    });
    if (!view) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const response = webhookViewSchema.safeParse(view);
    if (!response.success) {
      console.error("bijgewerkte webhook voldoet niet aan het contract:", response.error);
      return NextResponse.json(
        { error: "Opslaan mislukt. Probeer het opnieuw." },
        { status: 500 },
      );
    }
    return NextResponse.json(response.data);
  } catch (err) {
    if (err instanceof WebhookUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("webhook-update mislukt:", err);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/webhooks/[id] — verwijderen + cascade-deliveries. Teamlid.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionTeam();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const { id } = await params;
  const deleted = await deleteWebhook(pool, {
    teamId: auth.ctx.teamId,
    webhookId: id,
  });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
