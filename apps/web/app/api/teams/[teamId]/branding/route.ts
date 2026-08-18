import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { brandingSchema } from "@scanpal/shared";
import { assertPlanFeature, PlanFeatureError } from "@/lib/credits";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });

  try {
    await assertPlanFeature(pool, teamId, "white_label");
  } catch (error) {
    if (error instanceof PlanFeatureError) {
      return NextResponse.json(
        { error: error.message, upsell: { plan: "max" }, feature: "white_label" },
        { status: 403 },
      );
    }
    throw error;
  }

  const body = await request.json().catch(() => null);
  const parsed = brandingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige branding" },
      { status: 400 },
    );
  }

  const result = await pool.query(
    "update teams set branding = $2::jsonb where id = $1 returning branding",
    [teamId, JSON.stringify(parsed.data)],
  );
  if (result.rowCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ branding: result.rows[0].branding });
}
