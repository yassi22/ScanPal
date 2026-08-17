import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { reportDataSchema, reportFormatSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { buildReportData, reportFilename, type ReportRenderData } from "@/lib/report/data";
import { renderMarkdown } from "@/lib/report/markdown";
import { renderPdf } from "@/lib/report/pdf";
import { saveReport } from "@/lib/report/store";

export const runtime = "nodejs";

function authError(status: number, retryAfter?: number) {
  return NextResponse.json(
    { error: status === 429 ? "Te veel verzoeken" : "Unauthorized" },
    {
      status,
      headers: status === 429 ? { "Retry-After": String(retryAfter) } : undefined,
    },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const auth = await requireTeam(request);
  if (!auth.ok) return authError(auth.status, auth.retryAfter);
  const teamId = auth.ctx.teamId;

  const url = new URL(request.url);
  const format = reportFormatSchema.safeParse(
    url.searchParams.get("format") ?? "md",
  );
  if (!format.success) {
    return NextResponse.json(
      { error: "Ongeldige format — gebruik md of pdf" },
      { status: 400 },
    );
  }

  const { scanId } = await params;
  const result = await buildReportData(pool, scanId, teamId);
  if (!result.ok) {
    if (result.reason === "not_completed") {
      return NextResponse.json(
        { error: "Scan is nog niet voltooid", status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const checked = reportDataSchema.safeParse(result.data);
  if (!checked.success) {
    console.error("rapport voldoet niet aan het contract:", checked.error);
    return NextResponse.json(
      { error: "Rapport genereren mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  const input: ReportRenderData = { data: checked.data, omitted: result.omitted };
  const filename = reportFilename(
    checked.data.site.url,
    checked.data.scan.completed_at,
    format.data,
  );

  let content: Buffer;
  if (format.data === "pdf") {
    try {
      content = await renderPdf(input);
    } catch (err) {
      console.error("PDF-rendering mislukt:", err);
      return NextResponse.json(
        {
          error:
            "PDF genereren mislukt. Probeer Markdown of probeer het opnieuw.",
        },
        { status: 500 },
      );
    }
  } else {
    content = Buffer.from(renderMarkdown(input), "utf8");
  }

  const meta = await saveReport(pool, {
    teamId,
    siteId: result.siteId,
    scanId,
    format: format.data,
    filename,
    content,
  });

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type":
        format.data === "pdf" ? "application/pdf" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Report-Id": meta.id,
    },
  });
}