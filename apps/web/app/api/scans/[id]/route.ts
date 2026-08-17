import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { summarizeFindings } from "@/lib/scan-progress";

export const runtime = "nodejs";

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

  const { id } = await params;

  const result = await pool.query(
    `select s.*, st.url as site_url from scans s
     join sites st on st.id = s.site_id
     where s.id = $1 and st.team_id = $2`,
    [id, teamId],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = result.rows[0];
  const findings = (row.findings ?? {}) as Record<string, unknown>;

  // Plan 54: ontdekte routes + denormaliseerde teller voor de resultatenpagina.
  const routesResult = await pool.query(
    `select url, source, http_status from scan_routes
     where scan_id = $1 order by created_at asc`,
    [id],
  );

  return NextResponse.json({
    id: row.id,
    site_id: row.site_id,
    site_url: row.site_url,
    status: row.status,
    progress: row.progress,
    progress_details: row.progress_details ?? null,
    score: row.score,
    findings,
    summary:
      row.status === "completed" ? summarizeFindings(findings) : null,
    error:
      row.status === "failed" && typeof findings.error === "string"
        ? findings.error
        : null,
    route_count: row.route_count ?? routesResult.rowCount ?? 0,
    routes: routesResult.rows,
    created_at: row.created_at,
    completed_at: row.completed_at,
  });
}
