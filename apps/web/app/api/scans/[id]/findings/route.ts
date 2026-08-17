import { NextRequest, NextResponse } from "next/server";
import { findingsQuerySchema, findingsResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { queryFindings } from "@/lib/findings-core";

export const runtime = "nodejs";

/**
 * GET /api/scans/[id]/findings — gefilterde findings-lijst (plan 09,
 * feature 20). Authz identiek aan GET /api/scans/[id]: scans JOIN sites op
 * team_id (sessie of API-key); geen match → 404 (geen existence-leak).
 * Legacyscans zonder v1-payload geven een lege lijst ("geen findings —
 * herscan").
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

  const { id } = await params;

  const entries = [...request.nextUrl.searchParams.entries()].filter(
    ([, value]) => value !== "",
  );
  const parsedQuery = findingsQuerySchema.safeParse(Object.fromEntries(entries));
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: "Ongeldige query-parameters" },
      { status: 400 },
    );
  }

  const result = await pool.query(
    `select s.findings from scans s
     join sites st on st.id = s.site_id
     where s.id = $1 and st.team_id = $2`,
    [id, teamId],
  );
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const page = queryFindings(result.rows[0].findings, parsedQuery.data);
  const parsed = findingsResponseSchema.safeParse(page);
  if (!parsed.success) {
    console.error("findings voldoen niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
