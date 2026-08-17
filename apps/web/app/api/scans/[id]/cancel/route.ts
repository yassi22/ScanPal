import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { scanCreateResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import {
  cancelScan,
  CancelScanError,
  toScanJson,
} from "@/lib/scans-core";

export const runtime = "nodejs";

/**
 * POST /api/scans/[id]/cancel — zet een queued/running scan op `canceled`
 * (plan 19). Terminale statussen → 409; geen body. Retourneert de scan
 * (zelfde vorm als `scanCreateResponseSchema`).
 */
export async function POST(
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
  const teamId = auth.ctx.teamId;

  const { id } = await params;

  try {
    const scan = await cancelScan(pool, { teamId, scanId: id });

    const parsed = scanCreateResponseSchema.safeParse({
      scan: toScanJson(scan),
    });
    if (!parsed.success) {
      throw new Error("scan voldoet niet aan het contract");
    }

    return NextResponse.json(parsed.data, { status: 200 });
  } catch (err) {
    if (err instanceof CancelScanError) {
      if (err.code === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (err.code === "not_cancelable") {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
    }
    console.error("scan cancelen mislukt:", err);
    return NextResponse.json(
      { error: "Scan annuleren mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}