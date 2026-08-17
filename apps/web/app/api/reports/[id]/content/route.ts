import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getReportContent } from "@/lib/report/store";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 429 ? "Te veel verzoeken" : "Unauthorized" },
      {
        status: auth.status,
        headers:
          auth.status === 429
            ? { "Retry-After": String(auth.retryAfter) }
            : undefined,
      },
    );
  }
  const { id } = await params;

  const row = await getReportContent(pool, {
    teamId: auth.ctx.teamId,
    reportId: id,
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(row.content), {
    status: 200,
    headers: {
      "Content-Type":
        row.format === "pdf" ? "application/pdf" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${row.filename}"`,
    },
  });
}