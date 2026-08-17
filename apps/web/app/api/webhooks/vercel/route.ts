import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { vercelWebhookSchema, type VercelWebhook } from "@scanpal/shared";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import {
  listSitesByVercelUrl,
  startDeployScan,
  verifyHmacSignature,
} from "@/lib/deploy-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/vercel — on-deploy trigger (plan 58). Vercel signed
 * (`x-vercel-signature`, HMAC-SHA256 met het team/deploy-secret uit env
 * `VERCEL_WEBHOOK_SECRET`). Event: `deployment.completed`; de payload-url
 * matcht de site-host. Geen match → 200; ongeldige handtekening → 401;
 * scan gestart → 202.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-vercel-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  if (!env.vercelWebhookSecret) {
    return NextResponse.json(
      { error: "Vercel webhook is niet geconfigureerd" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (!verifyHmacSignature(env.vercelWebhookSecret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: VercelWebhook;
  try {
    payload = vercelWebhookSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const sites = await listSitesByVercelUrl(pool, payload.payload.url);
  if (sites.length === 0) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const scans: { site_id: string; scan_id: string }[] = [];
  for (const site of sites) {
    const outcome = await startDeployScan(pool, {
      siteId: site.id,
      teamId: site.team_id,
      siteName: site.url,
    });
    if (outcome.status === "started") {
      scans.push({ site_id: site.id, scan_id: outcome.scanId });
    }
  }

  if (scans.length > 0) {
    return NextResponse.json({ scans }, { status: 202 });
  }
  return NextResponse.json({ skipped: true }, { status: 200 });
}