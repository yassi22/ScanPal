import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { membershipWorkspaceSchema } from "@scanpal/shared";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";
import { WorkspaceError, assignMemberWorkspace } from "@/lib/workspaces-core";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; userId: string }> },
) {
  const { teamId, userId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const parsed = membershipWorkspaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige workspace" }, { status: 400 });
  try {
    await assignMemberWorkspace(pool, { teamId, userId, workspaceId: parsed.data.workspace_id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkspaceError) return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 });
    throw error;
  }
}
