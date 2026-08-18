import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createWorkspaceSchema, workspaceSchema } from "@scanpal/shared";
import { requireOwner, requireTeamMember } from "@/lib/authz";
import { pool } from "@/lib/db";
import { createWorkspace, listWorkspaces, toWorkspaceJson } from "@/lib/workspaces-core";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await requireTeamMember(teamId);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const rows = await listWorkspaces(pool, {
    teamId,
    workspaceId: auth.membership.role === "owner" ? undefined : auth.membership.workspace_id,
  });
  const workspaces = rows.map(toWorkspaceJson);
  const parsed = workspaceSchema.array().safeParse(workspaces);
  if (!parsed.success) return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
  return NextResponse.json({ workspaces: parsed.data });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const parsed = createWorkspaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" }, { status: 400 });
  const workspace = toWorkspaceJson(await createWorkspace(pool, { teamId, name: parsed.data.name }));
  return NextResponse.json({ workspace }, { status: 201 });
}
