import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ScanTrendPoint } from "@scanpal/shared";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getScanTrend } from "@/lib/scans-core";
import { getPlanForTeam } from "@/lib/credits";
import { ScanTrendChart } from "@/components/scan-trend-chart";
import { DomainWatchtowerCard } from "@/components/domain-watchtower-card";
import { PublicStatusToggle } from "@/components/public-status-toggle";
import { DeployWebhookCard } from "@/components/deploy-webhook-card";
import { getMembershipWorkspace } from "@/lib/workspace-scope";

export const dynamic = "force-dynamic";

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (score >= 50) return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Klaar",
  failed: "Mislukt",
  canceled: "Geannuleerd",
  running: "Bezig",
  queued: "In wachtrij",
};

export default async function SiteDetailPage({
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

  const scope =
    result.membership.role === "owner"
      ? { role: "owner", workspaceId: null }
      : await getMembershipWorkspace(pool, { teamId: result.team.id, userId: user.id });
  const { site, points } = await getScanTrend(pool, {
    teamId: result.team.id,
    siteId: id,
    workspaceId: scope.role === "owner" ? undefined : scope.workspaceId,
  });

  if (!site) notFound();

  const plan = await getPlanForTeam(pool, result.team.id);

  const trendPoints: ScanTrendPoint[] = points.map((p) => ({
    id: p.id,
    status: p.status,
    score: p.score,
    category_scores: p.category_scores,
    trigger: p.trigger,
    created_at: p.created_at.toISOString(),
    completed_at: p.completed_at ? p.completed_at.toISOString() : null,
  }));

  const recent = [...trendPoints].reverse().slice(0, 10);
  const latest = trendPoints[trendPoints.length - 1] ?? null;
  const previous = trendPoints.length >= 2 ? trendPoints[trendPoints.length - 2] : null;
  const delta =
    latest?.score !== null &&
    latest?.score !== undefined &&
    previous?.score !== null &&
    previous?.score !== undefined
      ? latest.score - previous.score
      : null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/sites"
          className="text-sm text-slate-400 transition hover:text-slate-200"
        >
          ← Sites
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          {site.label ?? site.url}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{site.url}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs font-semibold text-slate-400">Laatste score</p>
          <p className="mt-2 text-3xl font-bold">
            {site.last_scan_score !== null ? (
              <span
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${scoreColor(site.last_scan_score)}`}
              >
                {site.last_scan_score}
              </span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs font-semibold text-slate-400">Vorige score</p>
          <p className="mt-2 text-3xl font-bold">
            {previous?.score !== null && previous?.score !== undefined ? (
              <span
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${scoreColor(previous.score)}`}
              >
                {previous.score}
              </span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs font-semibold text-slate-400">Verschil</p>
          <p className="mt-2 text-3xl font-bold">
            {delta === null ? (
              <span className="text-slate-600">—</span>
            ) : delta > 0 ? (
              <span className="text-emerald-400">+{delta}</span>
            ) : delta < 0 ? (
              <span className="text-red-400">{delta}</span>
            ) : (
              <span className="text-slate-400">±0</span>
            )}
          </p>
        </div>
      </div>

      <ScanTrendChart points={trendPoints} />

      <DomainWatchtowerCard siteId={site.id} />

      <PublicStatusToggle siteId={site.id} initialSlug={site.public_status_slug} />

      <DeployWebhookCard
        siteId={site.id}
        githubRepo={site.github_repo}
        configured={site.github_webhook_configured}
        onDeployEnabled={plan.features.onDeploy}
      />

      <div>
        <h2 className="text-lg font-semibold">Recente scans</h2>
        {recent.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-700 p-8 text-center">
            <p className="text-sm text-slate-400">
              Nog geen voltooide scans. Start een scan vanaf de sites-pagina.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Scan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">Trigger</th>
                  <th className="px-5 py-3 font-medium">Datum</th>
                  <th className="px-5 py-3 font-medium text-right">Actie</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((scan) => (
                  <tr
                    key={scan.id}
                    className="border-b border-slate-800/60 last:border-b-0"
                  >
                    <td className="px-5 py-4 font-mono text-xs text-slate-400">
                      {scan.id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={
                          scan.status === "completed"
                            ? "text-emerald-400"
                            : scan.status === "failed"
                              ? "text-red-400"
                              : "text-slate-400"
                        }
                      >
                        {STATUS_LABELS[scan.status] ?? scan.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {scan.score !== null ? (
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${scoreColor(scan.score)}`}
                        >
                          {scan.score}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {scan.trigger === "manual"
                        ? "Handmatig"
                        : scan.trigger === "deploy"
                          ? "Deploy"
                          : "Gepland"}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {formatDateTime(scan.completed_at ?? scan.created_at)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {scan.status === "completed" ? (
                        <Link
                          href={`/scans/${scan.id}`}
                          className="text-xs font-semibold text-brand underline-offset-2 hover:underline"
                        >
                          Bekijk
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
