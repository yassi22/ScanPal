import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowSquareOut,
  ChartLineUp,
  CheckCircle,
  ClockCounterClockwise,
} from "@phosphor-icons/react/dist/ssr";
import type { ScanTrendPoint } from "@scanpal/shared";
import { pool } from "@/lib/db";
import { getScanTrend } from "@/lib/scans-core";
import { getPlanForTeam } from "@/lib/credits";
import { getCompletedScoreHistory } from "@/lib/site-score-history";
import { ScanTrendChart } from "@/components/scan-trend-chart";
import { DomainWatchtowerCard } from "@/components/domain-watchtower-card";
import { PublicStatusToggle } from "@/components/public-status-toggle";
import { DeployWebhookCard } from "@/components/deploy-webhook-card";
import { OwnershipVerificationCard } from "@/components/ownership-verification-card";
import { SiteScanAutoRefresh } from "@/components/site-scan-auto-refresh";
import { getMembershipWorkspace } from "@/lib/workspace-scope";
import { getDashboardContext } from "@/lib/dashboard-context";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function scoreTone(score: number): string {
  if (score >= 80) return "is-good";
  if (score >= 50) return "is-watch";
  return "is-risk";
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Complete",
  failed: "Failed",
  canceled: "Canceled",
  running: "Running",
  queued: "Queued",
};

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await getDashboardContext();
  const user = result.authUser;

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
  const { completedPoints, latest: latestCompleted, previous, delta } =
    getCompletedScoreHistory(trendPoints);
  const deltaLabel =
    delta === null
      ? "Not enough scan history"
      : delta > 0
        ? `Improved by ${delta} points`
        : delta < 0
          ? `Dropped by ${Math.abs(delta)} points`
          : "No score change";

  return (
    <div className="dashboard-home site-detail-page" data-design-direction="luminous-technical-calm">
      <SiteScanAutoRefresh siteId={site.id} initialStatus={site.last_scan_status} />
      <header className="site-detail-header">
        <div className="site-detail-heading">
          <Link href="/sites" className="site-detail-back-link">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to sites
          </Link>
          <h1>{site.label ?? site.url}</h1>
          <a href={site.url} target="_blank" rel="noreferrer" className="site-detail-url">
            {site.url}
            <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
        </div>
        {latestCompleted && (
          <Link href={`/scans/${latestCompleted.id}`} className="site-detail-primary-action">
            View latest report
            <ArrowSquareOut size={16} aria-hidden="true" />
          </Link>
        )}
      </header>

      <section className="site-score-overview" aria-labelledby="site-score-heading">
        <div className="site-score-lead">
          <span className="site-score-icon" aria-hidden="true">
            <ChartLineUp size={22} />
          </span>
          <div>
            <p id="site-score-heading">Latest website health</p>
            {site.last_scan_score !== null ? (
              <strong className={`site-detail-score ${scoreTone(site.last_scan_score)}`}>
                {site.last_scan_score}<small>/100</small>
              </strong>
            ) : (
              <strong className="site-detail-score is-empty">Not scanned</strong>
            )}
          </div>
        </div>
        <dl className="site-score-history">
          <div>
            <dt>Previous score</dt>
            <dd>{previous?.score ?? "—"}</dd>
          </div>
          <div>
            <dt>Trend</dt>
            <dd className={delta !== null && delta < 0 ? "is-risk" : delta !== null && delta > 0 ? "is-good" : ""}>
              {deltaLabel}
            </dd>
          </div>
          <div>
            <dt>Completed scans</dt>
            <dd>{completedPoints.length}</dd>
          </div>
        </dl>
      </section>

      <div className="site-detail-stack">
        <ScanTrendChart points={trendPoints} />
        <OwnershipVerificationCard siteId={site.id} />
        <DomainWatchtowerCard siteId={site.id} />
        <PublicStatusToggle siteId={site.id} initialSlug={site.public_status_slug} />
        <DeployWebhookCard
          siteId={site.id}
          githubRepo={site.github_repo}
          configured={site.github_webhook_configured}
          onDeployEnabled={plan.features.onDeploy}
          webhookUrl={`${env.appUrl}/api/webhooks/github`}
        />
      </div>

      <section className="site-recent-scans" aria-labelledby="recent-scans-heading">
        <div className="site-section-heading">
          <div>
            <h2 id="recent-scans-heading">Recent scans</h2>
            <p>Open a completed scan to review its evidence and remediation steps.</p>
          </div>
          <ClockCounterClockwise size={22} aria-hidden="true" />
        </div>
        {recent.length === 0 ? (
          <div className="site-recent-empty">
            <CheckCircle size={22} aria-hidden="true" />
            <p>No scans yet. Start the first scan from the sites overview.</p>
          </div>
        ) : (
          <div className="site-scan-table-wrap">
            <table className="site-scan-table">
              <thead>
                <tr>
                  <th>Scan</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Trigger</th>
                  <th>Date</th>
                  <th><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((scan) => (
                  <tr key={scan.id}>
                    <td data-label="Scan"><code>{scan.id.slice(0, 8)}</code></td>
                    <td data-label="Status">
                      <span className={`site-scan-status is-${scan.status}`}>
                        {STATUS_LABELS[scan.status] ?? scan.status}
                      </span>
                    </td>
                    <td data-label="Score">
                      {scan.score !== null ? (
                        <strong className={`site-table-score ${scoreTone(scan.score)}`}>{scan.score}</strong>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td data-label="Trigger">
                      {scan.trigger === "manual"
                        ? "Manual"
                        : scan.trigger === "deploy"
                          ? "Deploy"
                          : "Scheduled"}
                    </td>
                    <td data-label="Date">
                      {formatDateTime(scan.completed_at ?? scan.created_at)}
                    </td>
                    <td data-label="Action">
                      {scan.status === "completed" ? (
                        <Link href={`/scans/${scan.id}`} className="site-table-action">
                          View report
                          <ArrowSquareOut size={14} aria-hidden="true" />
                        </Link>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="dashboard-page-footer">
        <span>Signals are measured per scan and may change over time.</span>
        <span>ScanPal · Site dossier</span>
      </footer>
    </div>
  );
}
