import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { siteScheduleSchema } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { ScanError, setSiteSchedule } from "@/lib/scans-core";

export const runtime = "nodejs";

async function authorizeSite(siteId: string) {
  const user = await getSessionUser();
  if (!user) return null;

  const result = await pool.query(
    `select s.team_id from sites s
     join memberships m on m.team_id = s.team_id
     where s.id = $1 and m.user_id = $2 and m.status = 'accepted'`,
    [siteId, user.id],
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].team_id as string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const teamId = await authorizeSite(id);
  if (!teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = siteScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  if (parsed.data.frequency !== "none") {
    const plan = await getPlanForTeam(pool, teamId);
    if (plan.id !== "pro") {
      return NextResponse.json(
        {
          error: "Geplande scans zijn alleen beschikbaar op Pro.",
          upsell: { plan: "pro" },
          feature: "schedule",
        },
        { status: 403 },
      );
    }
  }

  try {
    const schedule = await setSiteSchedule(pool, {
      teamId,
      siteId: id,
      frequency: parsed.data.frequency,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    if (err instanceof ScanError && err.code === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("schema instellen mislukt:", err);
    return NextResponse.json(
      { error: "Schema instellen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
