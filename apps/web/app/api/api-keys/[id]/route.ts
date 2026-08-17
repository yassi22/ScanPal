import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { revokeApiKey } from "@/lib/api-keys-core";

export const runtime = "nodejs";

/**
 * DELETE /api/api-keys/[id] — soft-revoke (revoked_at). Alleen de
 * team-owner; een key van een ander team → 404 (geen existence-leak).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionOwner();
  if (!auth.ok) {
    return NextResponse.json(
      {
        error:
          auth.status === 403
            ? "Alleen de team-owner kan API-keys beheren"
            : "Unauthorized",
      },
      { status: auth.status },
    );
  }

  const { id } = await params;
  const revoked = await revokeApiKey(pool, {
    teamId: auth.ctx.teamId,
    keyId: id,
  });
  if (!revoked) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
