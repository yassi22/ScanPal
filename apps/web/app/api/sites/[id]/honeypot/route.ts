import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { honeypotSetupResponseSchema, updateHoneypotSchema, isPaidPlan } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { setHoneypot } from "@/lib/threats-core";

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const teamId = await authorizeSite(id);
  if (!teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const plan = await getPlanForTeam(pool, teamId);
  if (!isPaidPlan(plan.id)) {
    return NextResponse.json(
      {
        error: "Threat-monitoring is alleen beschikbaar op Pro.",
        upsell: { plan: "pro" },
        feature: "threats",
      },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateHoneypotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const result = await setHoneypot(pool, teamId, id, {
    enabled: parsed.data.enabled,
    rotateToken: parsed.data.rotate_token,
  });
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const response = honeypotSetupResponseSchema.safeParse({
    honeypot: result.view,
    snippet: result.snippet,
  });
  if (!response.success) {
    console.error("honeypot-setup voldoet niet aan het contract:", response.error);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(response.data);
}
