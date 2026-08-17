import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { plans, type UserRole } from "@scanpal/shared";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteErrorCode =
  | "not_found"
  | "expired"
  | "already_accepted"
  | "already_member"
  | "pending_exists"
  | "last_owner"
  | "email_mismatch"
  | "member_limit";

export class InviteError extends Error {
  constructor(
    public code: InviteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

export type InvitationRow = {
  id: string;
  team_id: string;
  email: string;
  role: UserRole;
  token: string;
  expires_at: Date | string;
  invited_by: string | null;
  accepted_at: Date | string | null;
  created_at: Date | string;
  team_name?: string;
};

export type PendingInvitation = {
  id: string;
  team_id: string;
  email: string;
  role: UserRole;
  token: string;
  expires_at: Date | string;
  created_at: Date | string;
};

export type TeamMemberRow = {
  user_id: string;
  name: string | null;
  email: string;
  role: UserRole;
  status: string;
  created_at: Date | string;
};

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

async function maxMembersForTeam(
  db: Pool | PoolClient,
  teamId: string,
): Promise<number> {
  const result = await db.query(
    "select plan from subscriptions where team_id = $1",
    [teamId],
  );
  const planId = (result.rows[0]?.plan as string | undefined) ?? "free";
  return plans[planId as keyof typeof plans].maxMembers;
}

async function assertSeatAvailable(
  db: Pool | PoolClient,
  teamId: string,
  countSeats: () => Promise<number>,
): Promise<void> {
  const maxMembers = await maxMembersForTeam(db, teamId);
  const seats = await countSeats();
  if (seats >= maxMembers) {
    throw new InviteError(
      "member_limit",
      `De ledenlimiet van dit plan (${maxMembers}) is bereikt. Upgrade naar Pro voor meer leden.`,
    );
  }
}

export async function createInvitation(
  db: Pool,
  input: { teamId: string; email: string; role: UserRole; invitedBy: string },
): Promise<InvitationRow> {
  const email = input.email.trim().toLowerCase();
  const client = await db.connect();
  try {
    await client.query("begin");

    const member = await client.query(
      `select 1 from memberships m
       join users u on u.id = m.user_id
       where m.team_id = $1 and lower(u.email) = $2 and m.status = 'accepted'`,
      [input.teamId, email],
    );
    if (member.rowCount && member.rowCount > 0) {
      throw new InviteError("already_member", "Dit e-mailadres is al lid van het team");
    }

    const pending = await client.query(
      `select 1 from invitations
       where team_id = $1 and lower(email) = $2 and accepted_at is null`,
      [input.teamId, email],
    );
    if (pending.rowCount && pending.rowCount > 0) {
      throw new InviteError("pending_exists", "Er staat al een uitnodiging open voor dit e-mailadres");
    }

    await assertSeatAvailable(client, input.teamId, async () => {
      const members = await client.query(
        `select count(*)::int as n from memberships
         where team_id = $1 and status = 'accepted'`,
        [input.teamId],
      );
      const pendingCount = await client.query(
        `select count(*)::int as n from invitations
         where team_id = $1 and accepted_at is null and expires_at > now()`,
        [input.teamId],
      );
      return (members.rows[0].n as number) + (pendingCount.rows[0].n as number);
    });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const inserted = await client.query(
      `insert into invitations (team_id, email, role, token, expires_at, invited_by)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [input.teamId, email, input.role, token, expiresAt, input.invitedBy],
    );

    await client.query("commit");
    return inserted.rows[0] as InvitationRow;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getInvitation(
  db: Pool,
  token: string,
): Promise<InvitationRow | null> {
  const result = await db.query(
    `select i.id, i.team_id, i.email, i.role, i.token, i.expires_at,
            i.invited_by, i.accepted_at, i.created_at, t.name as team_name
     from invitations i
     join teams t on t.id = i.team_id
     where i.token = $1`,
    [token],
  );
  return result.rowCount ? (result.rows[0] as InvitationRow) : null;
}

export async function acceptInvitation(
  db: Pool,
  input: { token: string; userId: string; email: string },
): Promise<{ status: "accepted" | "already_accepted"; teamId: string }> {
  const invitation = await getInvitation(db, input.token);
  if (!invitation) {
    throw new InviteError("not_found", "Uitnodiging niet gevonden");
  }
  if (new Date(invitation.expires_at) < new Date()) {
    throw new InviteError("expired", "Deze uitnodiging is verlopen");
  }
  if (invitation.accepted_at) {
    return { status: "already_accepted", teamId: invitation.team_id };
  }
  if (invitation.email.toLowerCase() !== input.email.trim().toLowerCase()) {
    throw new InviteError(
      "email_mismatch",
      "Deze uitnodiging is bestemd voor een ander e-mailadres",
    );
  }

  const client = await db.connect();
  try {
    await client.query("begin");

    const alreadyMember = await client.query(
      `select 1 from memberships
       where team_id = $1 and user_id = $2 and status = 'accepted'`,
      [invitation.team_id, input.userId],
    );
    if (alreadyMember.rowCount === 0) {
      await assertSeatAvailable(client, invitation.team_id, async () => {
        const members = await client.query(
          `select count(*)::int as n from memberships
           where team_id = $1 and status = 'accepted'`,
          [invitation.team_id],
        );
        return members.rows[0].n as number;
      });
    }

    await client.query(
      `insert into memberships (team_id, user_id, role, status, invited_by)
       values ($1, $2, $3, 'accepted', $4)
       on conflict (team_id, user_id) do nothing`,
      [invitation.team_id, input.userId, invitation.role, invitation.invited_by],
    );

    await client.query(
      "update invitations set accepted_at = now() where id = $1",
      [invitation.id],
    );

    await client.query("commit");
    return { status: "accepted", teamId: invitation.team_id };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMembers(
  db: Pool,
  teamId: string,
): Promise<TeamMemberRow[]> {
  const result = await db.query(
    `select u.id as user_id, u.name, u.email, m.role, m.status, m.created_at
     from memberships m
     join users u on u.id = m.user_id
     where m.team_id = $1 and m.status = 'accepted'
     order by m.created_at asc`,
    [teamId],
  );
  return result.rows as TeamMemberRow[];
}

export async function listPendingInvitations(
  db: Pool,
  teamId: string,
): Promise<PendingInvitation[]> {
  const result = await db.query(
    `select id, team_id, email, role, token, expires_at, created_at
     from invitations
     where team_id = $1 and accepted_at is null and expires_at > now()
     order by created_at asc`,
    [teamId],
  );
  return result.rows as PendingInvitation[];
}

export async function deleteInvitation(
  db: Pool,
  input: { teamId: string; invitationId: string },
): Promise<boolean> {
  const result = await db.query(
    "delete from invitations where id = $1 and team_id = $2",
    [input.invitationId, input.teamId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateMemberRole(
  db: Pool,
  input: { teamId: string; userId: string; role: UserRole },
): Promise<void> {
  const member = await db.query(
    `select role from memberships
     where team_id = $1 and user_id = $2 and status = 'accepted'`,
    [input.teamId, input.userId],
  );
  if (member.rowCount === 0) {
    throw new InviteError("not_found", "Lid niet gevonden");
  }

  const current = member.rows[0].role as UserRole;
  if (current === input.role) return;

  if (current === "owner" && input.role === "member") {
    const owners = await db.query(
      `select count(*)::int as n from memberships
       where team_id = $1 and role = 'owner' and status = 'accepted'`,
      [input.teamId],
    );
    if ((owners.rows[0].n as number) <= 1) {
      throw new InviteError("last_owner", "De laatste owner kan niet worden gedemoot");
    }
  }

  await db.query(
    "update memberships set role = $1 where team_id = $2 and user_id = $3",
    [input.role, input.teamId, input.userId],
  );
}

export async function removeMember(
  db: Pool,
  input: { teamId: string; userId: string },
): Promise<void> {
  const member = await db.query(
    `select role from memberships
     where team_id = $1 and user_id = $2 and status = 'accepted'`,
    [input.teamId, input.userId],
  );
  if (member.rowCount === 0) {
    throw new InviteError("not_found", "Lid niet gevonden");
  }

  if (member.rows[0].role === "owner") {
    const owners = await db.query(
      `select count(*)::int as n from memberships
       where team_id = $1 and role = 'owner' and status = 'accepted'`,
      [input.teamId],
    );
    if ((owners.rows[0].n as number) <= 1) {
      throw new InviteError("last_owner", "De laatste owner kan niet worden verwijderd");
    }
  }

  await db.query(
    "delete from memberships where team_id = $1 and user_id = $2",
    [input.teamId, input.userId],
  );
}
