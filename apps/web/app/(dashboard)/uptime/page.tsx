import { pool } from "@/lib/db";
import { listUptimeSummaries } from "@/lib/uptime-core";
import { UptimeList } from "@/components/uptime/uptime-list";
import { getDashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

export default async function UptimePage() {
  const result = await getDashboardContext();

  const summaries = await listUptimeSummaries(pool, result.team.id);

  return (
    <div className="dashboard-home uptime-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading uptime-page-heading">
        <div>
          <h1>Know when a site goes quiet.</h1>
          <p>
            Availability is checked every 60 seconds. ScanPal confirms an
            outage after two failed checks, so a single network wobble stays noise.
          </p>
        </div>
        <span className="dashboard-plan-chip">
          {summaries.length} {summaries.length === 1 ? "endpoint" : "endpoints"}
        </span>
      </header>

      <UptimeList initial={summaries} />

      <footer className="dashboard-page-footer">
        <span>Automatic refresh every 30 seconds.</span>
        <span>ScanPal · Availability</span>
      </footer>
    </div>
  );
}
