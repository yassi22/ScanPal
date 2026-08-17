import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  webhookDeliveriesListQuerySchema,
  webhookDeliveriesListResponseSchema,
} from "@scanpal/shared";
import { requireSessionTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getWebhook, listWebhookDeliveries } from "@/lib/webhooks-core";

export const runtime = "nodejs";

/**
 * GET /api/webhooks/[id]/deliveries — delivery-log (status, http_status,
 * attempts, next_attempt_at), paginated. Teamlid, sessie-only; andere team
 * → 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionTeam();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const { id } = await params;
  const webhook = await getWebhook(pool, {
    teamId: auth.ctx.teamId,
    webhookId: id,
  });
  if (!webhook) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const query = webhookDeliveriesListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: query.error.issues[0]?.message ?? "Ongeldige query" },
      { status: 400 },
    );
  }

  const result = await listWebhookDeliveries(pool, {
    teamId: auth.ctx.teamId,
    webhookId: id,
    limit: query.data.limit,
    offset: query.data.offset,
  });

  const response = webhookDeliveriesListResponseSchema.safeParse(result);
  if (!response.success) {
    console.error("delivery-log voldoet niet aan het contract:", response.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
  return NextResponse.json(response.data);
}
