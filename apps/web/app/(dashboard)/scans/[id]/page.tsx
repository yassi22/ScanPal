import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { cruxDataSchema } from "@scanpal/shared";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { summarizeFindings } from "@/lib/scan-progress";
import type { ScanViewState } from "@/lib/use-scan-progress";
import { ScanResultView } from "@/components/scan-result";

export const dynamic = "force-dynamic";

export default async function ScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const scan = await pool.query(
    `select s.id, s.site_id, s.status, s.progress, s.progress_details, s.score,
            s.findings, s.crux, s.created_at, s.completed_at, s.route_count, st.url as site_url,
            st.label as site_label
     from scans s
     join sites st on st.id = s.site_id
     join memberships m on m.team_id = st.team_id
     where s.id = $1 and m.user_id = $2 and m.status = 'accepted'
       and (m.role = 'owner' or st.workspace_id = m.workspace_id)`,
    [id, user.id],
  );
  if (scan.rowCount === 0) notFound();

  const row = scan.rows[0];
  const findings = (row.findings ?? {}) as Record<string, unknown>;

  const cruxParsed = cruxDataSchema.safeParse(row.crux);

  const initial: ScanViewState = {
    status: row.status,
    progress: row.progress,
    progressDetails: row.progress_details ?? null,
    score: row.score ?? null,
    findings,
    summary: row.status === "completed" ? summarizeFindings(findings) : null,
    error:
      row.status === "failed" && typeof findings.error === "string"
        ? findings.error
        : null,
    routeCount: row.route_count ?? null,
    crux: cruxParsed.success ? cruxParsed.data : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };

  return (
    <ScanResultView
      scanId={row.id}
      siteId={row.site_id}
      siteUrl={row.site_url}
      siteLabel={row.site_label}
      initial={initial}
      needsOnboarding={result.user.onboarding_completed_at === null}
    />
  );
}
