"use client";

import { useEffect, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import {
  categoryLabels,
  severityOrder,
  type Finding,
  type FindingSeverity,
  type ScanDiff,
  type SeverityCounts,
} from "@scanpal/shared";

type Props = {
  scanId: string;
};

type DiffData = {
  diff: ScanDiff;
  findings: Finding[];
};

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: "bg-red-500/15 text-red-400",
  high: "bg-orange-500/15 text-orange-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-slate-500/15 text-slate-300",
  info: "bg-sky-500/15 text-sky-400",
};

function totalCount(counts: SeverityCounts): number {
  return (
    counts.critical + counts.high + counts.medium + counts.low + counts.info
  );
}

function routePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return url;
  }
}

type FindingGroup = {
  key: string;
  title: string;
  severity: FindingSeverity;
  category: Finding["category"];
  findings: Finding[];
  routes: string[];
  snoozed: number;
};

const GROUP_PREVIEW_SIZE = 6;
const ROUTE_PREVIEW_SIZE = 8;

function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();

  for (const finding of findings) {
    const key = [
      finding.check_id,
      finding.title,
      finding.severity,
      finding.category,
    ].join("::");
    const current = groups.get(key);

    if (current) {
      current.findings.push(finding);
      if (finding.route_url && !current.routes.includes(finding.route_url)) {
        current.routes.push(finding.route_url);
      }
      if (finding.snooze_until) current.snoozed += 1;
      continue;
    }

    groups.set(key, {
      key,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      findings: [finding],
      routes: finding.route_url ? [finding.route_url] : [],
      snoozed: finding.snooze_until ? 1 : 0,
    });
  }

  return [...groups.values()].sort((a, b) => {
    const severityDifference =
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (severityDifference !== 0) return severityDifference;
    if (a.findings.length !== b.findings.length) {
      return b.findings.length - a.findings.length;
    }
    return a.title.localeCompare(b.title, "en");
  });
}

function FindingGroupRow({
  group,
  kind,
}: {
  group: FindingGroup;
  kind: "new" | "regressed";
}) {
  const count = group.findings.length;
  const hiddenRouteCount = Math.max(group.routes.length - ROUTE_PREVIEW_SIZE, 0);

  return (
    <li className="scan-diff-group">
      <details>
        <summary>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[group.severity]}`}
          >
            {SEVERITY_LABELS[group.severity]}
          </span>
          <span className="scan-diff-group-title">{group.title}</span>
          <span className="scan-diff-group-count">
            {count} {count === 1 ? "finding" : "findings"}
          </span>
          <span className="scan-diff-group-category">
            {categoryLabels[group.category]}
          </span>
          <CaretDown className="scan-diff-caret" size={16} aria-hidden="true" />
        </summary>

        <div className="scan-diff-group-details">
          <p>
            {kind === "new" ? "Newly found" : "Recurring"} on{" "}
            {group.routes.length > 0
              ? `${group.routes.length} ${group.routes.length === 1 ? "route" : "routes"}`
              : `${count} ${count === 1 ? "check" : "checks"}`}.
          </p>
          {group.routes.length > 0 && (
            <ul className="scan-diff-routes" aria-label={`Affected routes for ${group.title}`}>
              {group.routes.slice(0, ROUTE_PREVIEW_SIZE).map((route) => (
                <li key={route} title={route}>
                  {routePath(route)}
                </li>
              ))}
              {hiddenRouteCount > 0 && (
                <li className="scan-diff-routes-more">+ {hiddenRouteCount} more</li>
              )}
            </ul>
          )}
          <div className="scan-diff-group-footer">
            {group.snoozed > 0 && (
              <span>
                {group.snoozed} {group.snoozed === 1 ? "finding is" : "findings are"}{" "}
                snoozed
              </span>
            )}
            <a href="#scan-findings">View in all findings</a>
          </div>
        </div>
      </details>
    </li>
  );
}

function GroupSection({
  title,
  groups,
  kind,
}: {
  title: string;
  groups: FindingGroup[];
  kind: "new" | "regressed";
}) {
  const [showAll, setShowAll] = useState(false);
  if (groups.length === 0) return null;

  const visibleGroups = showAll ? groups : groups.slice(0, GROUP_PREVIEW_SIZE);
  const hiddenGroups = groups.length - visibleGroups.length;

  return (
    <div className="scan-diff-section">
      <div className="scan-diff-section-heading">
        <h3>{title}</h3>
        <span>{groups.length} unique checks</span>
      </div>
      <ul className="scan-diff-groups">
        {visibleGroups.map((group) => (
          <FindingGroupRow key={group.key} group={group} kind={kind} />
        ))}
      </ul>
      {groups.length > GROUP_PREVIEW_SIZE && (
        <button
          type="button"
          className="scan-diff-show-all"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show ${hiddenGroups} more checks`}
        </button>
      )}
    </div>
  );
}

function SeverityChips({ counts }: { counts: SeverityCounts }) {
  return (
    <div className="flex flex-wrap gap-2">
      {severityOrder
        .filter((severity) => counts[severity] > 0)
        .map((severity) => (
          <span
            key={severity}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[severity]}`}
          >
            {counts[severity]} {SEVERITY_LABELS[severity]}
          </span>
        ))}
    </div>
  );
}

/**
 * "Wijzigingen" (plan 59, stap 5): wat is er veranderd t.o.v. de laatste
 * schone snapshot — nieuw / opgelost / teruggekeerd met badges. Gesnoozde
 * findings blijven zichtbaar (met indicator) maar hebben geen alert gegeven.
 */
export function DiffPanel({ scanId }: Props) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scans/${scanId}/diff`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json() as Promise<DiffData>;
      })
      .then((page) => {
        if (!cancelled) setData(page);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to fetch changes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  if (loading) return null;
  if (error) {
    return (
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-bold">Changes</h2>
        <p className="mt-2 text-sm text-red-400">{error}</p>
      </section>
    );
  }

  const diff = data?.diff;
  const newIds = new Set(diff?.new_finding_ids ?? []);
  const regressedIds = new Set(diff?.regressed_finding_ids ?? []);
  const newFindings = (data?.findings ?? []).filter((finding) =>
    newIds.has(finding.id),
  );
  const regressedFindings = (data?.findings ?? []).filter((finding) =>
    regressedIds.has(finding.id),
  );
  const newGroups = groupFindings(newFindings);
  const regressedGroups = groupFindings(regressedFindings);

  const hasChanges =
    diff !== undefined &&
    (newFindings.length > 0 ||
      regressedFindings.length > 0 ||
      totalCount(diff.resolved) > 0);

  if (!diff || !hasChanges) return null;

  return (
    <section className="scan-diff-panel mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="scan-diff-header">
        <div>
          <h2 className="text-lg font-bold">Changes since the previous scan</h2>
          <p>
            {newFindings.length + regressedFindings.length} findings bundled into{" "}
            {newGroups.length + regressedGroups.length} unique checks.
          </p>
        </div>
        <div className="scan-diff-totals" aria-label="Summary of changes">
          <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-400">
            {totalCount(diff.new)} new
          </span>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
            {totalCount(diff.resolved)} resolved
          </span>
          <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-semibold text-violet-400">
            {totalCount(diff.regressed)} regressed
          </span>
        </div>
      </div>
      <p className="scan-diff-baseline">
        Compared with the last clean scan (no open critical/severe
        findings or a score ≥ 80).
      </p>

      <GroupSection title="New" groups={newGroups} kind="new" />
      <GroupSection title="Regressed" groups={regressedGroups} kind="regressed" />

      {totalCount(diff.resolved) > 0 && (
        <div className="scan-diff-resolved">
          <h3>Resolved</h3>
          <div className="mt-2">
            <SeverityChips counts={diff.resolved} />
          </div>
          <p>
            These findings no longer appear in the latest scan.
          </p>
        </div>
      )}
    </section>
  );
}
