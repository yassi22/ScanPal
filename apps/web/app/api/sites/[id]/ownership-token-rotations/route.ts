import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rotateOwnershipToken } from "@scanpal/scan-core";
import { ownershipSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSite } from "@/lib/sites-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

const ROTATE_LIMIT_PER_MINUTE = 5;

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

  const { id } = await params;
  const teamId = auth.ctx.teamId;
  const workspaceId = workspaceIdForContext(auth.ctx);
  const site = await getSite(pool, {
    siteId: id,
    teamId,
    workspaceId,
  });
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const limit = await checkRateLimit(
      `ownership-rotate:${id}`,
      ROTATE_LIMIT_PER_MINUTE,
    );
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Te veel verzoeken" },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const ownership = await rotateOwnershipToken(pool, {
      siteId: id,
      teamId,
      workspaceId,
    });
    const parsed = ownershipSchema.safeParse(ownership);
    if (!parsed.success) {
      console.error("ownership-tokenrotatie voldoet niet aan het contract:", parsed.error);
      return NextResponse.json(
        { error: "Roteren mislukt. Probeer het opnieuw." },
        { status: 500 },
      );
    }
    return NextResponse.json(parsed.data);
  } catch (error) {
    console.error("ownership-token roteren mislukt:", error);
    return NextResponse.json(
      { error: "Roteren mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
