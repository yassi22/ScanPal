import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";
import { deleteInvitation } from "@/lib/invites-core";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string; invitationId: string }> },
) {
  const { teamId, invitationId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const deleted = await deleteInvitation(pool, { teamId, invitationId });
  if (!deleted) {
    return NextResponse.json(
      { error: "Uitnodiging niet gevonden" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
