import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { domainStatusResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getDomainStatus, listDomainEvents } from "@/lib/domain-core";

export const runtime = "nodejs";

/**
 * Plan 56 — `GET /api/sites/[id]/domain`: huidige domein-status (denormaliseerd
 * op `sites` + laatste nameservers/CAA uit `domain_events`) + recente events.
 * Team-scoped via `requireTeam` + existence-check (geen leak).
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

  const owned = await pool.query(
    "select 1 from sites where id = $1 and team_id = $2",
    [id, teamId],
  );
  if ((owned.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit
    ? Math.min(Math.max(Number(rawLimit) || 30, 1), 100)
    : 30;

  const [status, events] = await Promise.all([
    getDomainStatus(pool, id),
    listDomainEvents(pool, id, limit),
  ]);

  if (!status) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = {
    status,
    events: events.map((e) => ({
      id: e.id,
      site_id: e.site_id,
      field: e.field,
      old_value: e.old_value,
      new_value: e.new_value,
      checked_at: e.checked_at,
    })),
  };

  const parsed = domainStatusResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("domain-status voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
