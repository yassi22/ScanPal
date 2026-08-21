import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { inviteInputSchema } from "@scanpal/shared";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";
import {
  createInvitation,
  listPendingInvitations,
  nextPlanForMemberLimit,
  InviteError,
} from "@/lib/invites-core";
import { getPlanForTeam } from "@/lib/credits";
import { env } from "@/lib/env";
import { sendInviteEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const auth = await requireOwner(teamId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = inviteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  try {
    const invitation = await createInvitation(pool, {
      teamId,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: auth.user.id,
    });

    const team = await pool.query("select name from teams where id = $1", [
      teamId,
    ]);
    const teamName = (team.rows[0]?.name as string | undefined) ?? "je team";

    const email = await sendInviteEmail({
      to: invitation.email,
      teamName,
      inviteUrl: `${env.appUrl}/invite/${invitation.token}`,
    });

    return NextResponse.json({ invitation, email }, { status: 201 });
  } catch (err) {
    if (err instanceof InviteError) {
      if (err.code === "member_limit") {
        const plan = await getPlanForTeam(pool, teamId);
        const nextPlan = nextPlanForMemberLimit(plan.id);
        return NextResponse.json(
          {
            error: err.message,
            ...(nextPlan ? { upsell: { plan: nextPlan, feature: "seats" } } : {}),
          },
          { status: 409 },
        );
      }
      const status =
        err.code === "already_member" || err.code === "pending_exists" ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("invite aanmaken mislukt:", err);
    return NextResponse.json(
      { error: "Uitnodiging aanmaken mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  // Owner-only: invite-tokens (en de genodigde e-mails) mogen niet naar
  // gewone teamleden lekken; de lijst bevat sowieso nooit tokens.
  const auth = await requireOwner(teamId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const invitations = await listPendingInvitations(pool, teamId);
  return NextResponse.json({ invitations });
}
