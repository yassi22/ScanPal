import { NextResponse } from "next/server";
import {
  findingSchema,
  findingStatusUpdateSchema,
  findingsPayloadSchema,
  type Finding,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

/**
 * PATCH /api/scans/[id]/findings/[findingId] — status (open/fixed/ignored)
 * + optionele note op één finding (plan 09, feature 20). Zelfde authz als
 * de GET-route; onbekende finding in deze scan → 404. De note wordt bij elke
 * status-wijziging zonder opgegeven note leeggemaakt.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; findingId: string }> },
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

  const { id, findingId } = await params;

  const body = await request.json().catch(() => null);
  const parsedBody = findingStatusUpdateSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Ongeldige body — verwacht { status, note? }" },
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

  const payload = findingsPayloadSchema.safeParse(result.rows[0].findings);
  if (!payload.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const items = payload.data.items;
  const index = items.findIndex((finding) => finding.id === findingId);
  if (index === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated: Finding = {
    ...items[index],
    status: parsedBody.data.status,
    note: parsedBody.data.note ?? null,
  };
  items[index] = updated;

  await pool.query("update scans set findings = $1 where id = $2", [
    JSON.stringify({ v: 1, items }),
    id,
  ]);

  const parsedFinding = findingSchema.safeParse(updated);
  if (!parsedFinding.success) {
    return NextResponse.json(
      { error: "Bijwerken mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsedFinding.data);
}
