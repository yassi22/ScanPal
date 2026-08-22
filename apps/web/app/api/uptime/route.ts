import { NextResponse } from "next/server";
import { uptimeListResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { listUptimeSummaries } from "@/lib/uptime-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

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

  const summaries = await listUptimeSummaries(
    pool,
    teamId,
    workspaceIdForContext(auth.ctx),
  );
  const parsed = uptimeListResponseSchema.safeParse({ sites: summaries });
  if (!parsed.success) {
    console.error("uptime-lijst voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
