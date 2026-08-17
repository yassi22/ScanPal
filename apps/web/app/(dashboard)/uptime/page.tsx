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
    <div>
      <h1 className="text-2xl font-bold">Uptime</h1>
      <p className="mt-1 text-sm text-slate-400">
        Status van je sites — elke 60 seconden gecontroleerd, storing na twee
        mislukte checks.
      </p>

      <UptimeList initial={summaries} />
    </div>
  );
}
