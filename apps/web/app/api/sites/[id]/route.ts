import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSiteInputSchema, siteWithStatusSchema } from "@scanpal/shared";
import { requireSessionOwner, requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { assertPlanFeature, PlanFeatureError } from "@/lib/credits";
import {
  deleteSite,
  getSite,
  SiteError,
  toSiteJson,
  updateSite,
} from "@/lib/sites-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

async function authorizeSite(siteId: string, teamId: string) {
  const result = await pool.query(
    "select 1 from sites where id = $1 and team_id = $2",
    [siteId, teamId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 429 ? "Te veel verzoeken" : "Unauthorized" },
      {
        status: auth.status,
        headers:
          auth.status === 429
            ? { "Retry-After": String(auth.retryAfter) }
            : undefined,
      },
    );
  }
  const teamId = auth.ctx.teamId;
  const workspaceId = workspaceIdForContext(auth.ctx);

  const site = await getSite(pool, { teamId, siteId: id, workspaceId });
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsedSite = siteWithStatusSchema.safeParse(toSiteJson(site));
  if (!parsedSite.success) {
    console.error("site-detail voldoet niet aan het contract:", parsedSite.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json({ site: parsedSite.data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 429 ? "Te veel verzoeken" : "Unauthorized" },
      {
        status: auth.status,
        headers:
          auth.status === 429
            ? { "Retry-After": String(auth.retryAfter) }
            : undefined,
      },
    );
  }
  const teamId = auth.ctx.teamId;
  const workspaceId = workspaceIdForContext(auth.ctx);

  const current = await pool.query<{ public_status_slug: string | null }>(
    workspaceId === undefined
      ? "select public_status_slug from sites where id = $1 and team_id = $2"
      : "select public_status_slug from sites where id = $1 and team_id = $2 and workspace_id = $3",
    workspaceId === undefined ? [id, teamId] : [id, teamId, workspaceId],
  );
  if ((current.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSiteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const githubRepo =
    parsed.data.github_repo === undefined
      ? undefined
      : parsed.data.github_repo || null;

  if (parsed.data.workspace_id !== undefined) {
    if (auth.ctx.auth.type === "session" && auth.ctx.auth.role !== "owner") {
      return NextResponse.json({ error: "Alleen de team-owner kan workspaces koppelen" }, { status: 403 });
    }
    if (parsed.data.workspace_id) {
      const workspace = await pool.query(
        "select 1 from workspaces where id = $1 and parent_team_id = $2",
        [parsed.data.workspace_id, teamId],
      );
      if (workspace.rowCount === 0) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
  }

  if (githubRepo !== undefined && githubRepo !== null) {
    try {
      await assertPlanFeature(pool, teamId, "github");
    } catch (err) {
      if (err instanceof PlanFeatureError) {
        return NextResponse.json(
          {
            error: err.message,
            upsell: { plan: "pro" },
            feature: err.feature,
          },
          { status: 403 },
        );
      }
      throw err;
    }
  }

  try {
    const site = await updateSite(pool, {
      teamId,
      siteId: id,
      label: parsed.data.label,
      githubRepo,
      publicStatus: parsed.data.public_status,
      currentSlug: current.rows[0]?.public_status_slug ?? null,
      workspaceId: parsed.data.workspace_id,
      scopeWorkspaceId: workspaceId,
    });
    const parsedSite = siteWithStatusSchema.safeParse(toSiteJson(site));
    if (!parsedSite.success) {
      throw new Error("site voldoet niet aan het contract");
    }
    return NextResponse.json({ site: parsedSite.data });
  } catch (err) {
    if (err instanceof SiteError && err.code === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("site wijzigen mislukt:", err);
    return NextResponse.json(
      { error: "Wijzigen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireSessionOwner();
  if (!auth.ok) {
    return NextResponse.json(
      {
        error:
          auth.status === 403
            ? "Alleen de team-owner kan sites verwijderen"
            : "Unauthorized",
      },
      { status: auth.status },
    );
  }
  const teamId = auth.ctx.teamId;

  if (!(await authorizeSite(id, teamId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = await deleteSite(pool, { teamId, siteId: id });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
