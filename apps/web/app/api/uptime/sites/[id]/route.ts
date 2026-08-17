import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  uptimeDetailSchema,
  uptimeHistoryQuerySchema,
  updateUptimeMonitoringSchema,
} from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { getUptimeDetail, setUptimeMonitoring } from "@/lib/uptime-core";

export const runtime = "nodejs";

type AuthResult =
  | { response: NextResponse }
  | { teamId: string };

async function authResult(request: NextRequest): Promise<AuthResult> {
  const auth = await requireTeam(request);
  if (!auth.ok) {
    return {
      response: NextResponse.json(
        { error: auth.status === 429 ? "Te veel verzoeken" : "Unauthorized" },
        {
          status: auth.status,
          headers:
            auth.status === 429
              ? { "Retry-After": String(auth.retryAfter) }
              : undefined,
        },
      ),
    };
  }
  return { teamId: auth.ctx.teamId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authResult(request);
  if ("response" in auth) return auth.response;
  const teamId = auth.teamId;

  const query = uptimeHistoryQuerySchema.safeParse({
    days: request.nextUrl.searchParams.get("days") ?? "30",
  });
  if (!query.success) {
    return NextResponse.json(
      { error: query.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const detail = await getUptimeDetail(pool, teamId, id, query.data.days);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = uptimeDetailSchema.safeParse(detail);
  if (!parsed.success) {
    console.error("uptime-detail voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authResult(request);
  if ("response" in auth) return auth.response;
  const teamId = auth.teamId;

  const body = await request.json().catch(() => null);
  const parsed = updateUptimeMonitoringSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const updated = await setUptimeMonitoring(
    pool,
    teamId,
    id,
    parsed.data.enabled,
  );
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ enabled: parsed.data.enabled });
}
