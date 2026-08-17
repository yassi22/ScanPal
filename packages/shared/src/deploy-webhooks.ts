import { z } from "zod";
import { canonicalizeSiteUrl } from "./sites";

/**
 * On-deploy webhooks (plan 58): GitHub + Vercel → automatische herscan
 * (`trigger='deploy'`). Pure zod-schema's + matching-helpers; de HMAC-
 * verificatie zelf is platform-afhankelijk (node:crypto) en leeft in de
 * webapp (`apps/web/lib/deploy-webhooks.ts`).
 */

export const githubWebhookEventSchema = z.enum(["push", "deployment_status"]);
export type GithubWebhookEvent = z.infer<typeof githubWebhookEventSchema>;

/** GitHub `push`-payload: alleen de velden die we voor matching/events nodig hebben. */
export const githubPushPayloadSchema = z.object({
  ref: z.string(),
  repository: z.object({
    full_name: z.string(),
    default_branch: z.string(),
  }),
});
export type GithubPushPayload = z.infer<typeof githubPushPayloadSchema>;

/** GitHub `deployment_status`-payload: `state=success` → nieuwe scan. */
export const githubDeploymentStatusPayloadSchema = z.object({
  deployment_status: z.object({
    state: z.string(),
    environment: z.string().optional(),
  }),
  repository: z.object({
    full_name: z.string(),
  }),
});
export type GithubDeploymentStatusPayload = z.infer<
  typeof githubDeploymentStatusPayloadSchema
>;

/** Vercel `deployment.completed`-payload: `payload.url` matcht de site-host. */
export const vercelWebhookSchema = z.object({
  type: z.literal("deployment.completed"),
  payload: z.object({
    project: z.object({ name: z.string() }),
    url: z.string(),
  }),
});
export type VercelWebhook = z.infer<typeof vercelWebhookSchema>;

/** Webhook-setup-route: URL + eenmalig zichtbaar secret (plan 58). */
export const deployWebhookSetupResponseSchema = z.object({
  url: z.string(),
  secret: z.string().min(1),
});
export type DeployWebhookSetupResponse = z.infer<
  typeof deployWebhookSetupResponseSchema
>;

/** Case-insensitive match van `owner/repo` (GitHub stuurt `full_name` in oorspronkelijke case). */
export function githubRepoMatches(
  repoFullName: string,
  siteRepo: string,
): boolean {
  return repoFullName.toLowerCase() === siteRepo.toLowerCase();
}

/** Push telt alleen op de default branch (andere branches/PR's → geen scan). */
export function githubPushIsOnDefaultBranch(
  payload: GithubPushPayload,
): boolean {
  return payload.ref === `refs/heads/${payload.repository.default_branch}`;
}

/** Deployment-status telt alleen bij `success`. */
export function githubDeploymentSucceeded(
  payload: GithubDeploymentStatusPayload,
): boolean {
  return payload.deployment_status.state === "success";
}

/**
 * Host-match voor Vercel: de `url` uit de payload (bijv. `myapp.vercel.app`
 * of een custom domein, eventueel met `www.`) wordt vergeleken met de
 * canonieke site-URL (protocol/www-weggestript, hostname lowercase).
 * Paden op de site-URL worden genegeerd — de match gaat over de host.
 */
export function vercelUrlMatchesSite(
  vercelUrl: string,
  siteUrl: string,
): boolean {
  const payload = canonicalizeSiteUrl(vercelUrl);
  const site = canonicalizeSiteUrl(siteUrl);
  if (!payload || !site) return false;
  return payload.split(/[/?#]/)[0] === site.split(/[/?#]/)[0];
}