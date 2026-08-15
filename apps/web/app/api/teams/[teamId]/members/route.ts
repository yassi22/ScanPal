import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { pool } from "@/lib/db";
import { listMembers } from "@/lib/invites-core";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await requireTeamMember(teamId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const members = await listMembers(pool, teamId);
  return NextResponse.json({ members });
}
