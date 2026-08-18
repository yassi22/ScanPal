import type { Pool, PoolClient } from "pg";
import {
  canonicalizeGithubRepo,
  canonicalizeSiteUrl,
  detectGithubRepoFromUrl,
  generatePublicStatusSlug,
} from "@scanpal/shared";
import { setSiteScanState } from "@scanpal/scan-core";

export type SiteRowWithStatus = {
  id: string;
  team_id: string;
  workspace_id?: string | null;
  url: string;
  github_repo: string | null;
  label: string | null;
  public_status_slug: string | null;
  /** Plan 58: on-deploy-webhook geconfigureerd (secret aanwezig, nooit het secret zelf). */
  github_webhook_configured: boolean;
  last_scan_id: string | null;
  last_scan_status: "queued" | "running" | "completed" | "failed" | null;
  last_scan_score: number | null;
  last_scanned_at: Date | null;
  uptime_state: "up" | "down" | "unknown";
  scan_frequency: "none" | "daily" | "weekly";
  next_scan_at: Date | null;
  created_at: Date;
};

export type SiteErrorCode = "duplicate" | "not_found";

export class SiteError extends Error {
  constructor(
    public code: SiteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SiteError";
  }
}

export { setSiteScanState };

const SITE_COLUMNS = `id, team_id, workspace_id, url, github_repo, label, public_status_slug,
  (github_webhook_secret is not null) as github_webhook_configured,
  last_scan_id, last_scan_status, last_scan_score, last_scanned_at,
  uptime_state, scan_frequency, next_scan_at, created_at`;

export async function listSitesWithStatus(
  db: Pool,
  teamId: string,
  workspaceId?: string | null,
): Promise<SiteRowWithStatus[]> {
  const scope = workspaceId === undefined ? "" : " and workspace_id = $2";
  const result = await db.query(
    `select ${SITE_COLUMNS} from sites
     where team_id = $1${scope}
     order by last_scanned_at desc nulls last, created_at desc`,
    workspaceId === undefined ? [teamId] : [teamId, workspaceId],
  );
  return result.rows as SiteRowWithStatus[];
}

/** Eén site met status, team-scoped (MCP-tool get_site, plan 63). */
export async function getSite(
  db: Pool,
  input: { teamId: string; siteId: string; workspaceId?: string | null },
): Promise<SiteRowWithStatus | null> {
  const scope = input.workspaceId === undefined ? "" : " and workspace_id = $3";
  const result = await db.query(
    `select ${SITE_COLUMNS} from sites where id = $1 and team_id = $2${scope}`,
    input.workspaceId === undefined
      ? [input.siteId, input.teamId]
      : [input.siteId, input.teamId, input.workspaceId],
  );
  return (result.rows[0] as SiteRowWithStatus) ?? null;
}

async function findSite(
  db: Pool | PoolClient,
  input: { teamId: string; canonicalUrl: string },
): Promise<SiteRowWithStatus | null> {
  const result = await db.query(
    `select ${SITE_COLUMNS} from sites where team_id = $1`,
    [input.teamId],
  );
  const row = (result.rows as SiteRowWithStatus[]).find(
    (r) => canonicalizeSiteUrl(r.url) === input.canonicalUrl,
  );
  return row ?? null;
}

export async function createSite(
  db: Pool,
  input: {
    teamId: string;
    url: string;
    githubRepo?: string | null;
    label?: string | null;
    reuse?: boolean;
    workspaceId?: string | null;
  },
): Promise<{ site: SiteRowWithStatus; created: boolean }> {
  const canonicalUrl = canonicalizeSiteUrl(input.url);
  if (!canonicalUrl) {
    throw new SiteError("duplicate", "Ongeldige URL");
  }

  const client = await db.connect();
  try {
    await client.query("begin");

    const existing = await findSite(client, { teamId: input.teamId, canonicalUrl });
    if (existing) {
      if (input.reuse) {
        await client.query("commit");
        return { site: existing, created: false };
      }
      throw new SiteError("duplicate", "Deze site staat al op je lijst");
    }

    const githubRepo = input.githubRepo?.trim()
      ? canonicalizeGithubRepo(input.githubRepo.trim())
      : detectGithubRepoFromUrl(input.url);
    const label = input.label?.trim() || null;

    const inserted =
      input.workspaceId === undefined
        ? await client.query(
            `insert into sites (team_id, url, github_repo, label, next_domain_check_at)
             values ($1, $2, $3, $4, now())
             returning ${SITE_COLUMNS}`,
            [input.teamId, canonicalUrl, githubRepo, label],
          )
        : await client.query(
            `insert into sites (team_id, workspace_id, url, github_repo, label, next_domain_check_at)
             values ($1, $2, $3, $4, $5, now())
             returning ${SITE_COLUMNS}`,
            [input.teamId, input.workspaceId, canonicalUrl, githubRepo, label],
          );

    await client.query("commit");
    return { site: inserted.rows[0] as SiteRowWithStatus, created: true };
  } catch (err) {
    await client.query("rollback");
    if (err instanceof SiteError) throw err;
    if ((err as { code?: string }).code === "23505") {
      throw new SiteError("duplicate", "Deze site staat al op je lijst");
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSite(
  db: Pool,
  input: {
    teamId: string;
    siteId: string;
    label?: string | null;
    githubRepo?: string | null;
    /** Plan 57: publieke statuspagina aan/uit; `currentSlug` behoudt een
     *  bestaande slug bij her-toggle (geen onnodige rotatie). */
    publicStatus?: { enabled: boolean } | undefined;
    currentSlug?: string | null;
    workspaceId?: string | null;
    scopeWorkspaceId?: string | null;
  },
): Promise<SiteRowWithStatus> {
  const patches: string[] = [];
  const params: unknown[] = [];

  if (input.label !== undefined) {
    params.push(input.label?.trim() || null);
    patches.push(`label = $${params.length}`);
  }
  if (input.githubRepo !== undefined) {
    params.push(
      input.githubRepo ? canonicalizeGithubRepo(input.githubRepo) : null,
    );
    patches.push(`github_repo = $${params.length}`);
  }
  if (input.publicStatus !== undefined) {
    const slug = input.publicStatus.enabled
      ? input.currentSlug ?? generatePublicStatusSlug()
      : null;
    params.push(slug);
    patches.push(`public_status_slug = $${params.length}`);
  }
  if (input.workspaceId !== undefined) {
    params.push(input.workspaceId);
    patches.push(`workspace_id = $${params.length}`);
  }

  const siteIdPosition = params.length + 1;
  const teamIdPosition = params.length + 2;
  params.push(input.siteId, input.teamId);
  const scope = input.scopeWorkspaceId === undefined ? "" : ` and workspace_id = $${params.length + 1}`;
  if (input.scopeWorkspaceId !== undefined) params.push(input.scopeWorkspaceId);
  const result = await db.query(
    `update sites set ${patches.join(", ")}
     where id = $${siteIdPosition} and team_id = $${teamIdPosition}${scope}
     returning ${SITE_COLUMNS}`,
    params,
  );

  if (result.rowCount === 0) {
    throw new SiteError("not_found", "Site niet gevonden");
  }
  return result.rows[0] as SiteRowWithStatus;
}

export async function deleteSite(
  db: Pool,
  input: { teamId: string; siteId: string; scopeWorkspaceId?: string | null },
): Promise<boolean> {
  const scope = input.scopeWorkspaceId === undefined ? "" : " and workspace_id = $3";
  const result = await db.query(
    `delete from sites where id = $1 and team_id = $2${scope}`,
    input.scopeWorkspaceId === undefined
      ? [input.siteId, input.teamId]
      : [input.siteId, input.teamId, input.scopeWorkspaceId],
  );
  return (result.rowCount ?? 0) > 0;
}

export function toSiteJson(site: SiteRowWithStatus) {
  return {
    ...site,
    created_at: site.created_at.toISOString(),
    last_scanned_at: site.last_scanned_at
      ? site.last_scanned_at.toISOString()
      : null,
    next_scan_at: site.next_scan_at ? site.next_scan_at.toISOString() : null,
  };
}
