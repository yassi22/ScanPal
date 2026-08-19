import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  GlobeHemisphereWest,
  LockKey,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import type { Finding } from "@scanpal/shared";
import { pool } from "@/lib/db";
import { getDashboardContext } from "@/lib/dashboard-context";
import { getPlanForTeam } from "@/lib/credits";
import { listSitesWithStatus, type SiteRowWithStatus } from "@/lib/sites-core";
import { listScanHistory, type ScanHistoryRow } from "@/lib/scans-core";
import { getMembershipWorkspace } from "@/lib/workspace-scope";
import { queryFindings } from "@/lib/findings-core";

const lenses = [
  { label: "Security", detail: "Protection first", primary: true, icon: ShieldCheck },
  { label: "SEO", detail: "Be easier to find", primary: false, icon: MagnifyingGlass },
  { label: "Performance", detail: "Load with intent", primary: false, icon: Sparkle },
  {
    label: "AI visibility",
    detail: "Be understood",
    primary: false,
    icon: GlobeHemisphereWest,
  },
  { label: "Compliance", detail: "Build trust", primary: false, icon: CheckCircle },
] as const;

function siteName(site: SiteRowWithStatus) {
  return site.label?.trim() || site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function scanStatusLabel(status: ScanHistoryRow["status"]) {
  switch (status) {
    case "completed":
      return "Completed";
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    case "failed":
      return "Needs attention";
    default:
      return "Canceled";
  }
}

function formatDate(date: Date | null) {
  if (!date) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getFocusState({
  activeScan,
  hasSites,
  latestScan,
  latestCompletedScan,
  topFinding,
}: {
  activeScan?: ScanHistoryRow;
  hasSites: boolean;
  latestScan?: ScanHistoryRow;
  latestCompletedScan?: ScanHistoryRow;
  topFinding?: Finding;
}) {
  if (activeScan) {
    return {
      chip: activeScan.status === "running" ? "Scanning now" : "Queued",
      chipClass: "is-info",
      title: "Your next signal is on its way.",
      description:
        "ScanPal is checking the important surfaces of your site. You can keep working while the report is prepared.",
      action: "Open scan progress",
      href: `/scans/${activeScan.id}`,
    };
  }

  if (latestScan?.status === "failed") {
    return {
      chip: "Action needed",
      chipClass: "is-danger",
      title: "Your latest scan needs another look.",
      description:
        "The scan did not complete, so ScanPal has not turned missing data into a reassuring score. Review what failed before you retry.",
      action: "Review failed scan",
      href: `/scans/${latestScan.id}`,
    };
  }

  if (latestScan?.status === "canceled") {
    return {
      chip: "Scan canceled",
      chipClass: "is-warning",
      title: "Restart when you are ready for a fresh signal.",
      description:
        "The previous scan was canceled and does not count as a health result. Choose a site to create a complete baseline.",
      action: "Choose a site to rescan",
      href: "/sites",
    };
  }

  if (latestCompletedScan) {
    if (topFinding) {
      const highPriority = topFinding.severity === "critical" || topFinding.severity === "high";
      return {
        chip: `${topFinding.severity} priority`,
        chipClass: highPriority ? "is-danger" : topFinding.severity === "medium" ? "is-warning" : "is-neutral",
        title: topFinding.title,
        description: topFinding.description,
        action: "Open finding in report",
        href: `/scans/${latestCompletedScan.id}`,
      };
    }

    return {
      chip: "Signal ready",
      chipClass: "is-success",
      title: "Your latest scan has no open findings.",
      description:
        "Review the completed report for measured evidence, then keep the site in view with another scan when something changes.",
      action: "View latest report",
      href: `/scans/${latestCompletedScan.id}`,
    };
  }

  if (hasSites) {
    return {
      chip: "Ready to scan",
      chipClass: "is-neutral",
      title: "Your sites are ready for a clear signal.",
      description:
        "Run a scan to turn a URL into a ranked view of security, SEO, performance, AI visibility and compliance.",
      action: "Choose a site to scan",
      href: "/sites",
    };
  }

  return {
    chip: "First step",
    chipClass: "is-neutral",
    title: "See what your site needs next.",
    description:
      "Start with one URL. ScanPal will translate the technical detail into a clear, evidence-backed starting point.",
    action: "Set up your first scan",
    href: "/onboarding",
  };
}

export default async function DashboardHomePage() {
  const result = await getDashboardContext();
  const user = result.authUser;

  const plan = await getPlanForTeam(pool, result.team.id);
  const needsOnboarding = result.user.onboarding_completed_at === null;
  const workspaceId =
    result.membership.role === "owner"
      ? undefined
      : (await getMembershipWorkspace(pool, { teamId: result.team.id, userId: user.id }))
          .workspaceId;

  const [sites, scans] = await Promise.all([
    listSitesWithStatus(pool, result.team.id, workspaceId),
    listScanHistory(pool, { teamId: result.team.id, workspaceId }),
  ]);

  const activeScan = scans.find((scan) => scan.status === "queued" || scan.status === "running");
  const latestScan = scans[0];
  const latestCompletedScan = scans.find((scan) => scan.status === "completed");
  const topFinding = latestCompletedScan
    ? queryFindings(
        (
          await pool.query("select findings from scans where id = $1", [latestCompletedScan.id])
        ).rows[0]?.findings,
        { status: "open", sort: "severity", order: "desc", limit: 1, offset: 0 },
      ).findings[0]
    : undefined;
  const latestSite = sites[0];
  const score = latestCompletedScan?.score ?? null;
  const focus = getFocusState({
    activeScan,
    hasSites: sites.length > 0,
    latestScan,
    latestCompletedScan,
    topFinding,
  });
  const scanHref = needsOnboarding ? "/onboarding" : "/sites";

  return (
    <div className="dashboard-home" data-design-direction="luminous-technical-calm">
      <section className="dashboard-page-heading">
        <div>
          <h1>Keep your website health in view.</h1>
          <p>
            A quiet overview for <strong>{result.team.name}</strong>. Start with the next useful
            signal, then follow the evidence.
          </p>
        </div>
        <div className="dashboard-heading-actions">
          <span className="dashboard-plan-chip">{plan.name} plan</span>
          <Link className="dashboard-primary-button" href={scanHref}>
            <Plus size={17} weight="bold" aria-hidden="true" />
            {needsOnboarding ? "Set up first scan" : "Scan a new site"}
          </Link>
        </div>
      </section>

      <section className="dashboard-primary-grid" aria-label="Dashboard overview">
        <article className="dashboard-focus-panel">
          <div className="dashboard-focus-heading">
            <h2>{focus.title}</h2>
            <span className={`dashboard-state-chip ${focus.chipClass}`}>{focus.chip}</span>
          </div>
          <p className="dashboard-focus-copy">{focus.description}</p>
          <Link className="dashboard-dark-button" href={focus.href}>
            {focus.action}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Link>

          <div className="dashboard-preview-panel" aria-label="Preview of a ScanPal report">
            <div className="dashboard-preview-toolbar">
              <span>
                <ShieldCheck size={14} weight="fill" aria-hidden="true" />
                ScanPal report
              </span>
              <span>{latestCompletedScan ? "Latest scan" : "Preview"}</span>
            </div>
            <div className="dashboard-preview-body">
              <div className="dashboard-score-block">
                <span className="dashboard-score-label">Health score</span>
                <strong className="dashboard-score-value">{score ?? "—"}</strong>
                <span className="dashboard-score-context">
                  {latestCompletedScan ? "Measured out of 100" : "Available after your first scan"}
                </span>
              </div>
              <div className="dashboard-preview-lines">
                {lenses.slice(0, 4).map((lens) => {
                  const LensIcon = lens.icon;
                  return (
                    <div className="dashboard-preview-line" key={lens.label}>
                      <span className="dashboard-preview-icon">
                        <LensIcon size={14} weight="regular" aria-hidden="true" />
                      </span>
                      <span>{lens.label}</span>
                      <span className="dashboard-preview-line-fill" />
                      <ArrowRight size={13} weight="regular" aria-hidden="true" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </article>

        <aside className="dashboard-workspace-card">
          <div className="dashboard-card-heading">
            <h2>Workspace at a glance</h2>
            <span className="dashboard-workspace-mark" aria-hidden="true">
              <ShieldCheck size={18} weight="regular" />
            </span>
          </div>

          <div className="dashboard-metric-list">
            <div className="dashboard-metric-row">
              <span>Sites in workspace</span>
              <strong>{sites.length}</strong>
            </div>
            <div className="dashboard-metric-row">
              <span>Recent completed</span>
              <strong>{scans.filter((scan) => scan.status === "completed").length}</strong>
            </div>
            <div className="dashboard-metric-row">
              <span>Latest score</span>
              <strong>{score ?? "—"}</strong>
            </div>
          </div>

          <div className="dashboard-site-callout">
            <div className="dashboard-site-callout-icon">
              <GlobeHemisphereWest size={17} weight="regular" aria-hidden="true" />
            </div>
            <div>
              <span>{latestSite ? "Latest site" : "No site added yet"}</span>
              <strong>{latestSite ? siteName(latestSite) : "Start with a URL"}</strong>
            </div>
          </div>

          <Link className="dashboard-light-button" href="/sites">
            Manage sites
            <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </Link>

          <div className="dashboard-plan-note">
            <Sparkle size={15} weight="fill" aria-hidden="true" />
            <span>
              You&apos;re on the <strong>{plan.name}</strong> plan.
            </span>
            <Link href="/billing" aria-label="Review plan">
              Review
            </Link>
          </div>
        </aside>
      </section>

      <section className="dashboard-lower-grid">
        <article className="dashboard-activity-panel">
          <div className="dashboard-section-heading">
            <h2>Recent scans</h2>
            <Link href="/reports" className="dashboard-inline-link">
              View reports <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </Link>
          </div>

          {scans.length > 0 ? (
            <div className="dashboard-scan-list">
              {scans.slice(0, 4).map((scan) => (
                <Link href={`/scans/${scan.id}`} className="dashboard-scan-row" key={scan.id}>
                  <div className="dashboard-scan-row-main">
                    <span className={`dashboard-scan-status is-${scan.status}`}>
                      <span aria-hidden="true" />
                      {scanStatusLabel(scan.status)}
                    </span>
                    <strong>{scan.site_label || scan.site_url.replace(/^https?:\/\//, "")}</strong>
                  </div>
                  <div className="dashboard-scan-row-meta">
                    <span>{formatDate(scan.completed_at ?? scan.created_at)}</span>
                    <strong>{scan.score ?? "—"}</strong>
                    <ArrowRight size={15} weight="regular" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty-state">
              <div className="dashboard-empty-icon">
                <MagnifyingGlass size={19} weight="regular" aria-hidden="true" />
              </div>
              <div>
                <strong>Your scan history will appear here.</strong>
                <p>Run your first scan to create a baseline you can return to.</p>
              </div>
              <Link className="dashboard-inline-link" href={scanHref}>
                Get started <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          )}
        </article>

        <article className="dashboard-lenses-panel">
          <div className="dashboard-section-heading">
            <h2>Five lenses, one useful signal.</h2>
          </div>
          <p className="dashboard-lenses-copy">
            Security leads. The surrounding checks show how browsers, search engines, people and
            AI systems experience your site.
          </p>
          <div className="dashboard-lens-list">
            {lenses.map((lens) => {
              const LensIcon = lens.icon;
              return (
                <div
                  className={`dashboard-lens-row${lens.primary ? " is-primary" : ""}`}
                  key={lens.label}
                >
                  <span className="dashboard-lens-icon">
                    <LensIcon size={16} weight="regular" aria-hidden="true" />
                  </span>
                  <span>{lens.label}</span>
                  <small>{lens.detail}</small>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <footer className="dashboard-page-footer">
        <span>
          <LockKey size={13} weight="regular" aria-hidden="true" />
          Evidence-backed by design.
        </span>
        <span>ScanPal workspace · {plan.name} plan</span>
      </footer>
    </div>
  );
}
