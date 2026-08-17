import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSiteInputSchema, siteWithStatusSchema } from "@scanpal/shared";
import { requireSessionOwner, requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { assertPlanFeature, PlanFeatureError } from "@/lib/credits";
import { deleteSite, SiteError, toSiteJson, updateSite } from "@/lib/sites-core";

export const runtime = "nodejs";

async function authorizeSite(siteId: string, teamId: string) {
  const result = await pool.query(
    "select 1 from sites where id = $1 and team_id = $2",
    [siteId, teamId],
  );
  return (result.rowCount ?? 0) > 0;
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

  if (!(await authorizeSite(id, teamId))) {
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
