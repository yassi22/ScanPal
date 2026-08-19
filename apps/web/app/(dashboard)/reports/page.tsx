import { pool } from "@/lib/db";
import { listReports } from "@/lib/report/store";
import { ReportsList } from "@/components/reports-list";
import { getMembershipWorkspace } from "@/lib/workspace-scope";
import { getDashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const result = await getDashboardContext();
  const user = result.authUser;

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
    <div className="dashboard-home reports-page" data-design-direction="luminous-technical-calm">
      <ReportsList
        sites={sites.rows}
        initialReports={reports}
        initialNextCursor={next_cursor}
      />

      <footer className="dashboard-page-footer">
        <span>Generated evidence, ready to share.</span>
        <span>ScanPal · Report archive</span>
      </footer>
    </div>
  );
}
