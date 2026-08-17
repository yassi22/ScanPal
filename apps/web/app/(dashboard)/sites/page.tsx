import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listSitesWithStatus, toSiteJson } from "@/lib/sites-core";
import { getPlanForTeam } from "@/lib/credits";
import { SitesManager } from "@/components/sites-manager";

export default async function SitesPage() {
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

  const [sites, plan] = await Promise.all([
    listSitesWithStatus(pool, result.team.id),
    getPlanForTeam(pool, result.team.id),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Sites</h1>
      <p className="mt-1 text-sm text-slate-400">
        Voeg websites toe, start scans en volg de status van je laatste scan.
      </p>

      <SitesManager
        sites={sites.map(toSiteJson)}
        githubEnabled={plan.features.github}
        schedulingEnabled={plan.id === "pro"}
        activeTestsEnabled={plan.features.activeTests}
        isOwner={result.membership.role === "owner"}
      />
    </div>
  );
}
