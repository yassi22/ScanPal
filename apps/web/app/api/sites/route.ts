import { NextResponse } from "next/server";
import {
  addSiteInputSchema,
  siteListResponseSchema,
  siteWithStatusSchema,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { assertPlanFeature, PlanFeatureError } from "@/lib/credits";
import {
  createSite,
  listSitesWithStatus,
  SiteError,
  toSiteJson,
} from "@/lib/sites-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const sites = (await listSitesWithStatus(pool, teamId, workspaceId)).map(toSiteJson);
  const parsed = siteListResponseSchema.safeParse({ sites });
  if (!parsed.success) {
    console.error("site-lijst voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const parsed = addSiteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const hasGithubRepo = !!parsed.data.github_repo?.trim();
  if (hasGithubRepo) {
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
    if (parsed.data.workspace_id) {
      const workspace = await pool.query(
        "select 1 from workspaces where id = $1 and parent_team_id = $2",
        [parsed.data.workspace_id, teamId],
      );
      if (workspace.rowCount === 0) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const { site, created } = await createSite(pool, {
      teamId,
      url: parsed.data.url,
      githubRepo: parsed.data.github_repo ?? null,
      label: parsed.data.label ?? null,
      reuse: parsed.data.reuse,
      workspaceId:
        workspaceId === undefined ? parsed.data.workspace_id : workspaceId,
    });

    const parsedSite = siteWithStatusSchema.safeParse(toSiteJson(site));
    if (!parsedSite.success) {
      throw new Error("site voldoet niet aan het contract");
    }

    if (!created) {
      if (parsed.data.reuse) {
        return NextResponse.json({ site: parsedSite.data }, { status: 200 });
      }
      return NextResponse.json(
        { error: "Deze site staat al op je lijst", site: parsedSite.data },
        { status: 409 },
      );
    }
    return NextResponse.json({ site: parsedSite.data }, { status: 201 });
  } catch (err) {
    if (err instanceof SiteError && err.code === "duplicate") {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("site aanmaken mislukt:", err);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
