import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateReportToken, reportShareInputSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const auth = await requireTeam(request);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const { scanId } = await params;
  const parsed = reportShareInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige vervaldatum" }, { status: 400 });

  const workspaceId = workspaceIdForContext(auth.ctx);
  const scope = workspaceId === undefined ? "" : " and st.workspace_id = $3";
  const owned = await pool.query(
    `select s.status from scans s join sites st on st.id = s.site_id
     where s.id = $1 and st.team_id = $2${scope}`,
    workspaceId === undefined ? [scanId, auth.ctx.teamId] : [scanId, auth.ctx.teamId, workspaceId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (owned.rows[0].status !== "completed") return NextResponse.json({ error: "Scan is nog niet voltooid" }, { status: 409 });

  const expiresAt = parsed.data.expires_at ? new Date(parsed.data.expires_at) : null;
  if (expiresAt && expiresAt <= new Date()) return NextResponse.json({ error: "Vervaldatum moet in de toekomst liggen" }, { status: 400 });
  const token = generateReportToken();
  const result = await pool.query(
    `update scans set report_token = $2, report_token_expires_at = $3
     where id = $1 returning report_token, report_token_expires_at`,
    [scanId, token, expiresAt],
  );
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    token: result.rows[0].report_token,
    expires_at: result.rows[0].report_token_expires_at
      ? new Date(result.rows[0].report_token_expires_at).toISOString()
      : null,
    url: `${origin}/report/${result.rows[0].report_token}`,
  });
}
