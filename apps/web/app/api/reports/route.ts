import { NextResponse } from "next/server";
import {
  decodeReportCursor,
  reportListQuerySchema,
  reportListResponseSchema,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { listReports } from "@/lib/report/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const query = reportListQuerySchema.safeParse({
    site_id: url.searchParams.get("site_id") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: "Ongeldige query" }, { status: 400 });
  }

  const siteId = query.data.site_id;
  if (siteId) {
    const owned = await pool.query(
      "select 1 from sites where id = $1 and team_id = $2",
      [siteId, teamId],
    );
    if (owned.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const cursor = query.data.cursor
    ? decodeReportCursor(query.data.cursor)
    : null;
  if (query.data.cursor && !cursor) {
    return NextResponse.json({ error: "Ongeldige cursor" }, { status: 400 });
  }

  const { reports, next_cursor } = await listReports(pool, {
    teamId,
    siteId,
    cursor,
    limit: query.data.limit,
  });
  const parsed = reportListResponseSchema.safeParse({ reports, next_cursor });
  if (!parsed.success) {
    console.error("rapport-historie voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}