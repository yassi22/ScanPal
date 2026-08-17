import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  emptyScanDiff,
  findingsPayloadSchema,
  scanDiffResponseSchema,
  scanDiffSchema,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/scans/[id]/diff — diff t.o.v. de laatste schone snapshot
 * (plan 59). Authz identiek aan GET /api/scans/[id] (scans JOIN sites op
 * team_id; geen match → 404, geen existence-leak). Retourneert de diff + de
 * diff-geselecteerde findings (nieuw + teruggekeerd) uit deze scan. Oude
 * scans zonder diff-veld leveren een lege diff op.
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

  const result = await pool.query(
    `select s.diff, s.findings from scans s
     join sites st on st.id = s.site_id
     where s.id = $1 and st.team_id = $2`,
    [id, teamId],
  );
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const diff = scanDiffSchema.safeParse(result.rows[0].diff);
  if (!diff.success) {
    return NextResponse.json({ diff: emptyScanDiff(), findings: [] });
  }

  const payload = findingsPayloadSchema.safeParse(result.rows[0].findings);
  const items = payload.success ? payload.data.items : [];
  const selected = new Set([
    ...diff.data.new_finding_ids,
    ...diff.data.regressed_finding_ids,
  ]);
  const findings = items.filter((finding) => selected.has(finding.id));

  const parsed = scanDiffResponseSchema.safeParse({ diff: diff.data, findings });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}