import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { completeOnboarding } from "@/lib/team";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await completeOnboarding(pool, user.id);
  return NextResponse.json({ ok: true });
}
