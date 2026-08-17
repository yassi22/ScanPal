import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { vercelUrlMatchesSite } from "@scanpal/shared";
import { redis } from "./redis";
import { notifier } from "./notify";
import {
  assertPlanFeature,
  CreditLimitError,
  PlanFeatureError,
} from "./credits";
import { createManualScan, ScanError } from "./scans-core";
import { enqueueScan } from "./scan-queue";

/**
 * On-deploy triggers (plan 58): gedeelde logica voor de GitHub- en
 * Vercel-webhookroutes. Site-matching + HMAC-verificatie zijn hier;
 * de credit/scan-logica hergebruikt `createManualScan` met
 * `trigger='deploy'` (plan 27: enqueue `scan.dispatcher`, nooit inline).
 * Cooldown per site via Redis (max 1 webhook-scan per 10 min).
 */

export const DEPLOY_COOLDOWN_SECONDS = 600;

export class DeployWebhookNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployWebhookNotConfiguredError";
  }
}

export type DeploySiteRow = {
  id: string;
  team_id: string;
  url: string;
  github_webhook_secret: string | null;
};

/** Timing-safe HMAC-SHA256-verificatie (GitHub `x-hub-signature-256` / Vercel `x-vercel-signature`). */
export function verifyHmacSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string,
): boolean {
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sites met een `github_repo`-match (case-insensitive, `owner/repo`). */
export async function listSitesByGithubRepo(
  db: Pool,
  repoFullName: string,
): Promise<DeploySiteRow[]> {
  const result = await db.query(
    `select id, team_id, url, github_webhook_secret
     from sites
     where github_repo is not null and lower(github_repo) = lower($1)`,
    [repoFullName],
  );
  return result.rows as DeploySiteRow[];
}

/** Sites waarvan de host overeenkomt met de Vercel-deploy-URL (payload-url vs canonieke site-URL). */
export async function listSitesByVercelUrl(
  db: Pool,
  vercelUrl: string,
): Promise<DeploySiteRow[]> {
  const result = await db.query(
    `select id, team_id, url, github_webhook_secret from sites where url is not null`,
  );
  return (result.rows as DeploySiteRow[]).filter((row) =>
    vercelUrlMatchesSite(vercelUrl, row.url),
  );
}

/**
 * Reserveert de cooldown (SET NX + TTL). Geeft `false` terug als de site nog
 * in de cooldown zit (webhook wordt dan overgeslagen). Bewust vóór de
 * scan-creatie zodat een tweede webhook tijdens de transactie niet dubbel
 * scant — de cooldown is conservatief.
 */
export async function reserveDeployCooldown(siteId: string): Promise<boolean> {
  const result = await redis.set(
    `deploy:cd:${siteId}`,
    "1",
    "EX",
    DEPLOY_COOLDOWN_SECONDS,
    "NX",
  );
  return result === "OK";
}

export type DeployScanOutcome =
  | { status: "started"; scanId: string }
  | { status: "skipped"; reason: "plan" | "cooldown" | "overlap" | "credit" };

/**
 * Start één on-deploy scan voor een site: Pro-gate (`on_deploy`), cooldown,
 * credit/overlap-check (via createManualScan, `trigger='deploy'`) en enqueue
 * `scan.dispatcher`. Credit-skip → notificatiehub (`credit_skip`),zelfde
 * patroon als de scheduler (plan 05).
 */
export async function startDeployScan(
  db: Pool,
  input: { siteId: string; teamId: string; siteName: string },
): Promise<DeployScanOutcome> {
  try {
    await assertPlanFeature(db, input.teamId, "onDeploy");
  } catch (err) {
    if (err instanceof PlanFeatureError) {
      return { status: "skipped", reason: "plan" };
    }
    throw err;
  }

  if (!(await reserveDeployCooldown(input.siteId))) {
    return { status: "skipped", reason: "cooldown" };
  }

  try {
    const { scan } = await createManualScan(db, {
      teamId: input.teamId,
      siteId: input.siteId,
      trigger: "deploy",
    });
    await enqueueScan(scan.id);
    return { status: "started", scanId: scan.id };
  } catch (err) {
    if (err instanceof CreditLimitError) {
      await notifier({
        type: "credit_skip",
        teamId: input.teamId,
        entityId: input.siteId,
        payload: { site_name: input.siteName },
      });
      return { status: "skipped", reason: "credit" };
    }
    if (err instanceof ScanError && err.code === "overlap") {
      return { status: "skipped", reason: "overlap" };
    }
    throw err;
  }
}