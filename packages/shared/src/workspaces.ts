import { z } from "zod";

/**
 * Werkruimten (plan 64): naamruimte onder een team om sites en leden te
 * organiseren (`sites.workspace_id`, `memberships.workspace_id`).
 */

/** Create-input: alleen de naam is door de klant aanpasbaar. */
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>;

/** Volledige DB-rij van een werkruimte. */
export const workspaceSchema = z.object({
  id: z.string().uuid(),
  parent_team_id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  created_at: z.string().datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

/** Rename-only PATCH-body: naam is verplicht en niet leeg. */
export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type WorkspaceUpdate = z.infer<typeof workspaceUpdateSchema>;

export const membershipWorkspaceSchema = z.object({
  workspace_id: z.string().uuid().nullable(),
});
export type MembershipWorkspace = z.infer<typeof membershipWorkspaceSchema>;
