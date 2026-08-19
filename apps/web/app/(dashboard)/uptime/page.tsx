import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listUptimeSummaries } from "@/lib/uptime-core";
import { UptimeList } from "@/components/uptime/uptime-list";

export const dynamic = "force-dynamic";

export default async function UptimePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await ensureUserTeam(pool, {
    id: user?.id ?? "",
    email: user?.email ?? "",
    name: user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null,
    avatar_url: user?.user_metadata?.avatar_url ?? null,
    auth_provider: user?.app_metadata?.provider ?? null,
  });

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
