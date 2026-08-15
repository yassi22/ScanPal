import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getInvitation } from "@/lib/invites-core";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const invitation = await getInvitation(pool, token);

  if (!invitation) {
    return NextResponse.json(
      { error: "Uitnodiging niet gevonden" },
      { status: 404 },
    );
  }

  const expired = new Date(invitation.expires_at) < new Date();
  if (expired) {
    return NextResponse.json(
      { error: "Deze uitnodiging is verlopen" },
      { status: 410 },
    );
  }

  return NextResponse.json({
    invitation: {
      team_id: invitation.team_id,
      team_name: invitation.team_name,
      email: invitation.email,
      role: invitation.role,
      expires_at: invitation.expires_at,
      accepted_at: invitation.accepted_at,
    },
  });
}
