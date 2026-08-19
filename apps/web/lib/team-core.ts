import type { Pool } from "pg";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  auth_provider?: string | null;
};

export type TeamResult = {
  team: { id: string; name: string };
  membership: {
    team_id: string;
    user_id: string;
    role: string;
    status: string;
    workspace_id: string | null;
  };
  user: { id: string; email: string; onboarding_completed_at: Date | null };
};

type TeamContextRow = {
  team_id: string;
  team_name: string;
  user_id: string;
  email: string;
  onboarding_completed_at: Date | null;
  role: string;
  status: string;
  workspace_id: string | null;
};

export async function getUserTeam(
  db: Pool,
  userId: string,
): Promise<TeamResult | null> {
  const result = await db.query<TeamContextRow>(
    `select t.id as team_id, t.name as team_name,
            u.id as user_id, u.email, u.onboarding_completed_at,
            m.role, m.status, m.workspace_id
       from users u
       join memberships m on m.user_id = u.id
       join teams t on t.id = m.team_id
      where u.id = $1
      limit 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    team: { id: row.team_id, name: row.team_name },
    membership: {
      team_id: row.team_id,
      user_id: row.user_id,
      role: row.role,
      status: row.status,
      workspace_id: row.workspace_id,
    },
    user: {
      id: row.user_id,
      email: row.email,
      onboarding_completed_at: row.onboarding_completed_at,
    },
  };
}

export async function ensureUserTeam(
  db: Pool,
  user: AuthUser,
  options: { recordLogin?: boolean } = {},
): Promise<TeamResult> {
  const client = await db.connect();
  try {
    await client.query("begin");

    await client.query(
      `insert into users (id, email, name, avatar_url, auth_provider, last_login_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (id) do update set
         email = excluded.email,
         name = coalesce(excluded.name, users.name),
         avatar_url = coalesce(excluded.avatar_url, users.avatar_url),
         auth_provider = coalesce(excluded.auth_provider, users.auth_provider),
         last_login_at = case when $6::boolean then now() else users.last_login_at end`,
      [
        user.id,
        user.email,
        user.name ?? null,
        user.avatar_url ?? null,
        user.auth_provider ?? null,
        options.recordLogin ?? false,
      ],
    );

    const existing = await client.query(
      "select team_id, role, status, workspace_id from memberships where user_id = $1",
      [user.id],
    );

    let teamId: string;
    let role = "member";
    let status = "accepted";

    if (existing.rowCount === 0) {
      const teamName = user.name ? `${user.name.split(" ")[0]}'s team` : "Mijn team";
      const team = await client.query(
        "insert into teams (name) values ($1) returning id",
        [teamName],
      );
      teamId = team.rows[0].id as string;
      role = "owner";
      await client.query(
        "insert into memberships (team_id, user_id, role, status) values ($1, $2, 'owner', 'accepted')",
        [teamId, user.id],
      );
      await client.query(
        `insert into subscriptions (team_id, plan, status, current_period_end, updated_at)
         values ($1, 'free', 'active', now() + interval '30 days', now())
         on conflict (team_id) do nothing`,
        [teamId],
      );
    } else {
      teamId = existing.rows[0].team_id as string;
      role = existing.rows[0].role as string;
      status = existing.rows[0].status as string;
    }

    const team = await client.query(
      "select id, name from teams where id = $1",
      [teamId],
    );
    const userRow = await client.query(
      "select id, email, onboarding_completed_at from users where id = $1",
      [user.id],
    );

    await client.query("commit");

    return {
      team: team.rows[0],
      membership: {
        team_id: teamId,
        user_id: user.id,
        role,
        status,
        workspace_id: (existing.rows[0]?.workspace_id as string | null) ?? null,
      },
      user: userRow.rows[0],
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrCreateUserTeam(
  db: Pool,
  user: AuthUser,
): Promise<TeamResult> {
  return (await getUserTeam(db, user.id)) ?? ensureUserTeam(db, user);
}

export async function completeOnboarding(
  db: Pool,
  userId: string,
): Promise<void> {
  await db.query("update users set onboarding_completed_at = now() where id = $1", [
    userId,
  ]);
}
