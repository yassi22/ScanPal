import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const result = await pool.query(
    `select s.* from scans s
     join sites st on st.id = s.site_id
     join memberships m on m.team_id = st.team_id
     where s.id = $1 and m.user_id = $2`,
    [id, user.id],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = result.rows[0];
  return NextResponse.json({
    id: row.id,
    site_id: row.site_id,
    status: row.status,
    progress: row.progress,
    score: row.score,
    findings: row.findings,
    completed_at: row.completed_at,
  });
}
