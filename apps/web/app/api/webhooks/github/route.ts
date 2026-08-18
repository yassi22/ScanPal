import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decryptWebhookSecret } from "@scanpal/notify";
import {
  githubDeploymentStatusPayloadSchema,
  githubDeploymentSucceeded,
  githubPushIsOnDefaultBranch,
  githubPushPayloadSchema,
  githubWebhookEventSchema,
} from "@scanpal/shared";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import {
  listSitesByGithubRepo,
  startDeployScan,
  verifyHmacSignature,
} from "@/lib/deploy-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/github — on-deploy trigger (plan 58). GitHub signed
 * (`x-hub-signature-256`, HMAC-SHA256 met het per-site secret) + eventheader
 * `x-github-event`. Events: push op de default branch + deployment_status
 * success. Geen match → 200 (geen 404-leak); ongeldige handtekening → 401;
 * scan gestart → 202. De signature wordt per site met haar eigen secret
 * geverifieerd: alleen sites waarvan het secret de payload tekent starten een
 * scan — een andere tenant die hetzelfde repo-volgende secret registreert kan
 * zo nooit de scans van het slachtoffer blokkeren (cross-tenant DoS fix).
 * Als géén enkele site verifieert → 401 (geen existence-leak).
 */
export async function POST(request: NextRequest) {
  const eventHeader = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256");
  if (!eventHeader || !signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const event = githubWebhookEventSchema.safeParse(eventHeader);
  if (!event.success) {
    // Onbekend event (ping, issues, …) → stilletjes accepteren zodat GitHub
    // geen retries stuurt; alleen push/deployment_status triggeren een scan.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const rawBody = await request.text();
  let repo: string;
  try {
    const parsed = JSON.parse(rawBody);
    if (event.data === "push") {
      const payload = githubPushPayloadSchema.parse(parsed);
      if (!githubPushIsOnDefaultBranch(payload)) {
        return NextResponse.json({ received: true }, { status: 200 });
      }
      repo = payload.repository.full_name;
    } else {
      const payload = githubDeploymentStatusPayloadSchema.parse(parsed);
      if (!githubDeploymentSucceeded(payload)) {
        return NextResponse.json({ received: true }, { status: 200 });
      }
      repo = payload.repository.full_name;
    }
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!env.webhookSecretKey) {
    return NextResponse.json(
      { error: "Webhooks zijn niet geconfigureerd" },
      { status: 503 },
    );
  }

  const sites = (await listSitesByGithubRepo(pool, repo)).filter(
    (site) => site.github_webhook_secret !== null,
  );
  if (sites.length === 0) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Per-site verificatie met het eigen secret; sites die niet verifiëren
  // (andere tenant, oud secret) worden overgeslagen, niet blokkerend.
  const verified: typeof sites = [];
  for (const site of sites) {
    let secret: string;
    try {
      secret = decryptWebhookSecret(
        env.webhookSecretKey,
        site.github_webhook_secret as string,
      );
    } catch {
      continue;
    }
    if (verifyHmacSignature(secret, rawBody, signature)) {
      verified.push(site);
    }
  }

  if (verified.length === 0) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const scans: { site_id: string; scan_id: string }[] = [];
  for (const site of verified) {
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