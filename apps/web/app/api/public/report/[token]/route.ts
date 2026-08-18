import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { reportDataSchema, brandingSchema, isValidReportToken } from "@scanpal/shared";
import { pool } from "@/lib/db";
import { getPublicReport } from "@/lib/public-report-core";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isValidReportToken(token)) return new NextResponse("Not Found", { status: 404 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  try {
    const limit = await checkRateLimit(`public-report:${ip}`, 60);
    if (!limit.ok) return NextResponse.json({ error: "Te veel verzoeken" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  } catch (error) {
    console.error("publieke rapport-rate-limit mislukt:", error);
  }

  const report = await getPublicReport(pool, token);
  if (!report) return new NextResponse("Not Found", { status: 404 });
  const checked = reportDataSchema.safeParse(report.data);
  const checkedBranding = brandingSchema.safeParse(report.branding);
  if (!checked.success || !checkedBranding.success) return NextResponse.json({ error: "Rapport ongeldig" }, { status: 500 });
  const response = NextResponse.json({ data: checked.data, branding: checkedBranding.data, expires_at: report.expires_at });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
