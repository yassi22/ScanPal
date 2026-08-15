import "server-only";

import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";

export type MembershipRow = {
  team_id: string;
  user_id: string;
  role: string;
  status: string;
};

export type AuthzSuccess = {
  ok: true;
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
  membership: MembershipRow;
};

export type AuthzFailure = {
  ok: false;
  status: 401 | 403;
};

export type AuthzResult = AuthzSuccess | AuthzFailure;

export async function requireTeamMember(teamId: string): Promise<AuthzResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };

  const result = await pool.query(
    `select team_id, user_id, role, status from memberships
     where team_id = $1 and user_id = $2 and status = 'accepted'`,
    [teamId, user.id],
  );
  if (result.rowCount === 0) return { ok: false, status: 403 };

  return { ok: true, user, membership: result.rows[0] as MembershipRow };
}

export async function requireOwner(teamId: string): Promise<AuthzResult> {
  const member = await requireTeamMember(teamId);
  if (!member.ok) return member;
  if (member.membership.role !== "owner") return { ok: false, status: 403 };
  return member;
}
