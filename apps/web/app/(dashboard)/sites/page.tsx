import { pool } from "@/lib/db";
import { listSitesWithStatus, toSiteJson } from "@/lib/sites-core";
import { getPlanForTeam } from "@/lib/credits";
import { SitesManager } from "@/components/sites-manager";
import { isPaidPlan } from "@scanpal/shared";
import { getMembershipWorkspace } from "@/lib/workspace-scope";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function SitesPage() {
  const result = await getDashboardContext();

  const scope =
    result.membership.role === "owner"
      ? { role: "owner", workspaceId: null }
      : await getMembershipWorkspace(pool, { teamId: result.team.id, userId: result.user.id });

  const [sites, plan] = await Promise.all([
    listSitesWithStatus(
      pool,
      result.team.id,
      scope.role === "owner" ? undefined : scope.workspaceId,
    ),
    getPlanForTeam(pool, result.team.id),
  ]);

  return (
    <div className="dashboard-home sites-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading sites-page-heading">
        <div>
          <h1>Your monitored sites.</h1>
          <p>
            Add a property, run an on-demand scan, and keep its security and
            availability signals in one calm workspace.
          </p>
        </div>
        <span className="dashboard-plan-chip">
          {sites.length} {sites.length === 1 ? "property" : "properties"}
        </span>
      </header>

      <SitesManager
        sites={sites.map(toSiteJson)}
        githubEnabled={plan.features.github}
        schedulingEnabled={isPaidPlan(plan.id)}
        activeTestsEnabled={plan.features.activeTests}
        isOwner={result.membership.role === "owner"}
      />

      <footer className="dashboard-page-footer">
        <span>Workspace data stays scoped to your team.</span>
        <span>ScanPal · Site operations</span>
      </footer>
    </div>
  );
}
