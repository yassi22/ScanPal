import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { workspaceUpdateSchema } from "@scanpal/shared";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";
import { WorkspaceError, deleteWorkspace, toWorkspaceJson, updateWorkspace } from "@/lib/workspaces-core";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; workspaceId: string }> },
) {
  const { teamId, workspaceId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const parsed = workspaceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" }, { status: 400 });
  try {
    const workspace = toWorkspaceJson(await updateWorkspace(pool, { teamId, workspaceId, name: parsed.data.name }));
    return NextResponse.json({ workspace });
  } catch (error) {
    if (error instanceof WorkspaceError && error.code === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string; workspaceId: string }> },
) {
  const { teamId, workspaceId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const deleted = await deleteWorkspace(pool, { teamId, workspaceId });
  return deleted ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
