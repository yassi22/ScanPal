import { NextResponse } from "next/server";
import { threatOverviewResponseSchema, isPaidPlan } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { listThreatOverviews } from "@/lib/threats-core";

export const runtime = "nodejs";

async function authTeam() {
  const user = await getSessionUser();
  if (!user) return null;
  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });
  return result.team.id;
}

export async function GET() {
  const teamId = await authTeam();
  if (!teamId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const overviews = await listThreatOverviews(pool, teamId);
  const parsed = threatOverviewResponseSchema.safeParse({ sites: overviews });
  if (!parsed.success) {
    console.error("threat-overzicht voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
