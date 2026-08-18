import { NextResponse } from "next/server";
import {
  scanCreateResponseSchema,
  scanHistoryResponseSchema,
  scanTriggerInputSchema,
  type ScanListItem,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { CreditLimitError, getPlanForTeam } from "@/lib/credits";
import { enqueueScan } from "@/lib/scan-queue";
import {
  createManualScan,
  listScanHistory,
  ScanError,
  toScanJson,
} from "@/lib/scans-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
  const workspaceId = workspaceIdForContext(auth.ctx);

  const body = await request.json().catch(() => null);
  const parsed = scanTriggerInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  if (parsed.data.active_tests) {
    const plan = await getPlanForTeam(pool, teamId);
    if (!plan.features.activeTests) {
      return NextResponse.json(
        {
          error:
            "Actieve vulnerability-tests zijn alleen beschikbaar op Pro.",
          upsell: { plan: "pro" },
          feature: "active_tests",
        },
        { status: 403 },
      );
    }
  }

  try {
    const { scan } = await createManualScan(pool, {
      teamId,
      siteId: parsed.data.site_id,
      activeTests: parsed.data.active_tests,
      workspaceId,
    });

    // Queue-modus (plan 27): enqueue + 202 — de worker-pipeline voert de scan
    // uit; de webapp wacht nooit op het resultaat.
    await enqueueScan(scan.id);

    const parsedScan = scanCreateResponseSchema.safeParse({
      scan: toScanJson(scan),
    });
    if (!parsedScan.success) {
      throw new Error(
        "scan voldoet niet aan het contract: " +
          JSON.stringify(parsedScan.error.issues),
      );
    }

    return NextResponse.json(parsedScan.data, { status: 202 });
  } catch (err) {
    if (err instanceof ScanError) {
      if (err.code === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (err.code === "overlap") {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
    }
    if (err instanceof CreditLimitError) {
      return NextResponse.json(
        {
          error: "Scan-limiet bereikt. Upgrade naar Pro voor meer scans per maand.",
          upsell: { plan: "pro" },
          usage: {
            creditsUsed: err.creditsUsed,
            creditsLimit: err.creditsLimit,
          },
        },
        { status: 402 },
      );
    }
    console.error("scan starten mislukt:", err);
    return NextResponse.json(
      { error: "Scan starten mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
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
  const workspaceId = workspaceIdForContext(auth.ctx);

  const url = new URL(request.url);
  const siteId = url.searchParams.get("site_id") ?? undefined;

  const rows = await listScanHistory(pool, { teamId, siteId, workspaceId });
  const scans: ScanListItem[] = rows.map((row) => ({
    ...row,
    scheduled_for: row.scheduled_for ? row.scheduled_for.toISOString() : null,
    created_at: row.created_at.toISOString(),
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
  }));

  const parsed = scanHistoryResponseSchema.safeParse({ scans });
  if (!parsed.success) {
    console.error("scan-historie voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
