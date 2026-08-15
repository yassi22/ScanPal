import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { roleChangeSchema } from "@scanpal/shared";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";
import { removeMember, updateMemberRole, InviteError } from "@/lib/invites-core";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; userId: string }> },
) {
  const { teamId, userId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = roleChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  try {
    await updateMemberRole(pool, { teamId, userId, role: parsed.data.role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InviteError) {
      const status = err.code === "last_owner" ? 400 : 404;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("rol wijzigen mislukt:", err);
    return NextResponse.json(
      { error: "Rol wijzigen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string; userId: string }> },
) {
  const { teamId, userId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  try {
    await removeMember(pool, { teamId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InviteError) {
      const status = err.code === "last_owner" ? 400 : 404;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("lid verwijderen mislukt:", err);
    return NextResponse.json(
      { error: "Lid verwijderen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
