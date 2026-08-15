import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  return NextResponse.json({
    user: {
      id: result.user.id,
      email: result.user.email,
      onboarding_completed_at: result.user.onboarding_completed_at?.toISOString() ?? null,
    },
    team: result.team,
    membership: result.membership,
    onboarding_completed: result.user.onboarding_completed_at !== null,
  });
}
