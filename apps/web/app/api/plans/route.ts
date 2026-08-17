import { NextResponse } from "next/server";
import { publicPlanSchema, planList } from "@scanpal/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const plans = planList.map((p) => publicPlanSchema.parse(p));
  return NextResponse.json({ plans });
}
