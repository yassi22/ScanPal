import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listReports } from "@/lib/report/store";
import { ReportsList } from "@/components/reports-list";
import { getMembershipWorkspace } from "@/lib/workspace-scope";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  const scope =
    result.membership.role === "owner"
      ? { role: "owner", workspaceId: null }
      : await getMembershipWorkspace(pool, { teamId: result.team.id, userId: user.id });
  const sites = await pool.query<{
    id: string;
    url: string;
    label: string | null;
  }>(
    scope.role === "owner"
      ? "select id, url, label from sites where team_id = $1 order by url"
      : "select id, url, label from sites where team_id = $1 and workspace_id = $2 order by url",
    scope.role === "owner"
      ? [result.team.id]
      : [result.team.id, result.membership.workspace_id],
  );
  const { reports, next_cursor } = await listReports(pool, {
    teamId: result.team.id,
    workspaceId:
      scope.role === "owner" ? undefined : scope.workspaceId,
  });

  return (
    <ReportsList
      sites={sites.rows}
      initialReports={reports}
      initialNextCursor={next_cursor}
    />
  );
}
