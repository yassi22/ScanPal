import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getOrCreateUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getTeamUsage } from "@/lib/credits";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { team } = await getOrCreateUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  const usage = await getTeamUsage(pool, team.id);

  return NextResponse.json({
    plan: usage.plan,
    status: usage.status,
    creditsUsed: usage.creditsUsed,
    creditsLimit: usage.creditsLimit,
    currentPeriodEnd: usage.currentPeriodEnd?.toISOString() ?? null,
    resetAt: usage.resetAt?.toISOString() ?? null,
  });
}
