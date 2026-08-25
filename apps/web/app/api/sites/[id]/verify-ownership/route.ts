import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkOwnershipLive,
  ensureOwnershipToken,
  recordOwnershipCheck,
} from "@scanpal/scan-core";
import { ownershipVerificationResponseSchema } from "@scanpal/shared";
import { requireTeam } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSite } from "@/lib/sites-core";
import { workspaceIdForContext } from "@/lib/workspace-scope";

export const runtime = "nodejs";

const VERIFY_LIMIT_PER_MINUTE = 5;

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
      `ownership-verify:${id}`,
      VERIFY_LIMIT_PER_MINUTE,
    );
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Te veel verificatiepogingen" },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const ownership = await ensureOwnershipToken(pool, {
      siteId: id,
      teamId,
      workspaceId,
    });
    if (!ownership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const check = await checkOwnershipLive(id, {
      db: pool,
      teamId,
      workspaceId,
    });
    const checkedToken = check.token ?? ownership.token;
    const verifiedAt = await recordOwnershipCheck(pool, {
      siteId: id,
      teamId,
      token: checkedToken,
      verified: check.verified,
      workspaceId,
    });

    const payload =
      verifiedAt === undefined
        ? { verified: false as const, reason: "token-rotated" as const }
        : check.verified && verifiedAt
          ? { verified: true as const, verified_at: verifiedAt.toISOString() }
          : {
              verified: false as const,
              reason: check.verified ? "token-rotated" as const : check.reason,
            };
    const parsed = ownershipVerificationResponseSchema.safeParse(payload);
    if (!parsed.success) {
      console.error("ownership-verificatie voldoet niet aan het contract:", parsed.error);
      return NextResponse.json(
        { error: "Verificatie mislukt. Probeer het opnieuw." },
        { status: 500 },
      );
    }
    return NextResponse.json(parsed.data);
  } catch (error) {
    console.error("ownership-verificatie mislukt:", error);
    return NextResponse.json(
      { error: "Verificatie mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
