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
 * + optionele note (plan 09) én snooze_until (7/30 dagen of "next-scan",
 * plan 59). Beide zijn optioneel: een snooze-actie verandert de status niet
 * en omgekeerd. Zelfde authz als de GET-route; onbekende finding in deze
 * scan → 404. De note wordt bij een status-wijziging zonder opgegeven note
 * leeggemaakt.
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
      { error: "Ongeldige body — verwacht { status?, note?, snooze_until? }" },
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

  const patch: Partial<Finding> = {};
  if (parsedBody.data.status !== undefined) {
    patch.status = parsedBody.data.status;
    patch.note = parsedBody.data.note ?? null;
  }
  if (parsedBody.data.snooze_until !== undefined) {
    patch.snooze_until = parsedBody.data.snooze_until;
  }

  const updated: Finding = { ...items[index], ...patch };
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
