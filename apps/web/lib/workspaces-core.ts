import "server-only";

import type { Pool } from "pg";
import type { Workspace } from "@scanpal/shared";

export class WorkspaceError extends Error {
  constructor(public code: "not_found" | "invalid_workspace", message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

type WorkspaceRow = {
  id: string;
  parent_team_id: string;
  name: string;
  created_at: Date;
};

export async function listWorkspaces(
  db: Pool,
  input: { teamId: string; workspaceId?: string | null },
): Promise<WorkspaceRow[]> {
  const scope = input.workspaceId === undefined ? "" : " and id = $2";
  const result = await db.query(
    `select id, parent_team_id, name, created_at
     from workspaces where parent_team_id = $1${scope}
     order by created_at asc, name asc`,
    input.workspaceId === undefined ? [input.teamId] : [input.teamId, input.workspaceId],
  );
  return result.rows as WorkspaceRow[];
}

export async function createWorkspace(
  db: Pool,
  input: { teamId: string; name: string },
): Promise<WorkspaceRow> {
  const result = await db.query(
    `insert into workspaces (parent_team_id, name)
     values ($1, $2) returning id, parent_team_id, name, created_at`,
    [input.teamId, input.name.trim()],
  );
  return result.rows[0] as WorkspaceRow;
}

export async function updateWorkspace(
  db: Pool,
  input: { teamId: string; workspaceId: string; name: string },
): Promise<WorkspaceRow> {
  const result = await db.query(
    `update workspaces set name = $3
     where id = $1 and parent_team_id = $2
     returning id, parent_team_id, name, created_at`,
    [input.workspaceId, input.teamId, input.name.trim()],
  );
  if (result.rowCount === 0) throw new WorkspaceError("not_found", "Workspace niet gevonden");
  return result.rows[0] as WorkspaceRow;
}

export async function deleteWorkspace(
  db: Pool,
  input: { teamId: string; workspaceId: string },
): Promise<boolean> {
  const result = await db.query(
    "delete from workspaces where id = $1 and parent_team_id = $2",
    [input.workspaceId, input.teamId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function assignSiteWorkspace(
  db: Pool,
  input: { teamId: string; siteId: string; workspaceId: string | null },
): Promise<void> {
  if (input.workspaceId) {
    const workspace = await db.query(
      "select 1 from workspaces where id = $1 and parent_team_id = $2",
      [input.workspaceId, input.teamId],
    );
    if (workspace.rowCount === 0) throw new WorkspaceError("invalid_workspace", "Workspace not found");
  }
  const result = await db.query(
    "update sites set workspace_id = $3 where id = $1 and team_id = $2",
    [input.siteId, input.teamId, input.workspaceId],
  );
  if (result.rowCount === 0) throw new WorkspaceError("not_found", "Site niet gevonden");
}

export async function assignMemberWorkspace(
  db: Pool,
  input: { teamId: string; userId: string; workspaceId: string | null },
): Promise<void> {
  if (input.workspaceId) {
    const workspace = await db.query(
      "select 1 from workspaces where id = $1 and parent_team_id = $2",
      [input.workspaceId, input.teamId],
    );
    if (workspace.rowCount === 0) throw new WorkspaceError("invalid_workspace", "Workspace not found");
  }
  const result = await db.query(
    `update memberships set workspace_id = $3
     where team_id = $1 and user_id = $2 and status = 'accepted'`,
    [input.teamId, input.userId, input.workspaceId],
  );
  if (result.rowCount === 0) throw new WorkspaceError("not_found", "Lid niet gevonden");
}

export function toWorkspaceJson(row: WorkspaceRow): Workspace {
  return { ...row, created_at: row.created_at.toISOString() };
}
