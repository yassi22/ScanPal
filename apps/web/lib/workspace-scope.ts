import type { TeamContext } from "./api-auth";
import type { Pool } from "pg";

/** undefined = team-wide access; null = unassigned member (no site access). */
export function workspaceIdForContext(ctx: TeamContext): string | null | undefined {
  if (ctx.auth.type === "key" || ctx.auth.role === "owner") return undefined;
  return ctx.auth.workspaceId;
}

export async function getMembershipWorkspace(
  db: Pool,
  input: { teamId: string; userId: string },
): Promise<{ role: string; workspaceId: string | null }> {
  const result = await db.query<{ role: string; workspace_id: string | null }>(
    `select role, workspace_id from memberships
     where team_id = $1 and user_id = $2 and status = 'accepted'`,
    [input.teamId, input.userId],
  );
  return {
    role: result.rows[0]?.role ?? "member",
    workspaceId: result.rows[0]?.workspace_id ?? null,
  };
}
