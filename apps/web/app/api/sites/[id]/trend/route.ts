import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { scanTrendResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getScanTrend } from "@/lib/scans-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

/**
 * Feature 10 — score-trend per site. GET /api/sites/[id]/trend geeft de
 * site-summary + voltooide/failed scans in chronologische volgorde. Team-
 * scoped via requireTeam + getScanTrend (geen existence-leak). Optionele
 * `?limit=` (default 50, max 100).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const { id } = await params;

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Number(rawLimit) : undefined;

  const { site, points } = await getScanTrend(pool, {
    teamId,
    siteId: id,
    workspaceId,
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
  });

  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = {
    site: {
      id: site.id,
      url: site.url,
      label: site.label,
      last_scan_score: site.last_scan_score,
      last_scanned_at: site.last_scanned_at
        ? site.last_scanned_at.toISOString()
        : null,
    },
    points: points.map((p) => ({
      id: p.id,
      status: p.status,
      score: p.score,
      category_scores: p.category_scores,
      trigger: p.trigger,
      created_at: p.created_at.toISOString(),
      completed_at: p.completed_at ? p.completed_at.toISOString() : null,
    })),
  };

  const parsed = scanTrendResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("scan-trend voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
