import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listReports } from "@/lib/report/store";
import { ReportsList } from "@/components/reports-list";

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

  const sites = await pool.query<{
    id: string;
    url: string;
    label: string | null;
  }>("select id, url, label from sites where team_id = $1 order by url", [
    result.team.id,
  ]);
  const { reports, next_cursor } = await listReports(pool, {
    teamId: result.team.id,
  });

  return (
    <ReportsList
      sites={sites.rows}
      initialReports={reports}
      initialNextCursor={next_cursor}
    />
  );
}