import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { threatEventsQuerySchema, threatEventsResponseSchema, isPaidPlan } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { listThreatEvents } from "@/lib/threats-core";

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

export async function GET(request: NextRequest) {
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

  const parsed = threatEventsQuerySchema.safeParse({
    site_id: request.nextUrl.searchParams.get("site_id") ?? undefined,
    risk: request.nextUrl.searchParams.get("risk") ?? undefined,
    kind: request.nextUrl.searchParams.get("kind") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? "1",
    page_size: request.nextUrl.searchParams.get("page_size") ?? "25",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const result = await listThreatEvents(pool, teamId, parsed.data);
  const response = threatEventsResponseSchema.safeParse({
    ...result,
    page: parsed.data.page,
    page_size: parsed.data.page_size,
  });
  if (!response.success) {
    console.error("threat-events voldoen niet aan het contract:", response.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(response.data);
}
