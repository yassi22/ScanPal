import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deployWebhookSetupResponseSchema } from "@scanpal/shared";
import { encryptWebhookSecret, generateWebhookSecret } from "@scanpal/notify";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * POST /api/sites/[id]/deploy-webhook — GitHub on-deploy webhook secret
 * genereren/roteren (plan 58). Owner-only; het secret wordt 1× versleuteld
 * opgeslagen (`sites.github_webhook_secret`, AES-GCM) en is alleen in deze
 * response zichtbaar. De webhook-URL is deterministisch:
 * `${APP_URL}/api/webhooks/github`.
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
            ? "Alleen de team-owner kan de deploy-webhook instellen"
            : "Unauthorized",
      },
      { status: auth.status },
    );
  }

  if (!env.webhookSecretKey) {
    return NextResponse.json(
      { error: "Webhooks zijn niet geconfigureerd (WEBHOOK_SECRET_KEY ontbreekt)" },
      { status: 503 },
    );
  }

  const { id } = await params;
  const secret = generateWebhookSecret();
  const secretEncrypted = encryptWebhookSecret(env.webhookSecretKey, secret);

  try {
    const result = await pool.query(
      `update sites set github_webhook_secret = $1
       where id = $2 and team_id = $3
       returning id`,
      [secretEncrypted, id, auth.ctx.teamId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (err) {
    console.error("deploy-webhook instellen mislukt:", err);
    return NextResponse.json(
      { error: "Instellen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  const url = `${env.appUrl}/api/webhooks/github`;
  const response = deployWebhookSetupResponseSchema.safeParse({ url, secret });
  if (!response.success) {
    console.error("deploy-webhook response voldoet niet aan het contract:", response.error);
    return NextResponse.json(
      { error: "Instellen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
  return NextResponse.json(response.data);
}