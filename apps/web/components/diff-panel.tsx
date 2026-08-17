"use client";

import { useEffect, useState } from "react";
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
  critical: "Kritiek",
  high: "Hoog",
  medium: "Medium",
  low: "Laag",
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

function snoozeLabel(finding: Finding): string | null {
  const until = finding.snooze_until;
  if (!until) return null;
  if (until === "next-scan") return "gesnoozd tot volgende scan";
  return `gesnoozd tot ${new Date(until).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  })}`;
}

function FindingRow({ finding, kind }: { finding: Finding; kind: "new" | "regressed" }) {
  const snoozed = snoozeLabel(finding);
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[finding.severity]}`}
        >
          {SEVERITY_LABELS[finding.severity]}
        </span>
        {kind === "regressed" && (
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-violet-400">
            Teruggekeerd
          </span>
        )}
        {kind === "new" && (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">
            Nieuw
          </span>
        )}
        <span className="flex-1 text-sm font-semibold text-slate-200">
          {finding.title}
        </span>
        {finding.route_url && (
          <span
            title={finding.route_url}
            className="max-w-[10rem] truncate rounded-full bg-slate-700/40 px-2 py-0.5 text-[10px] font-medium text-slate-400"
          >
            {routePath(finding.route_url)}
          </span>
        )}
        <span className="text-xs text-slate-500">
          {categoryLabels[finding.category]}
        </span>
      </div>
      {snoozed && (
        <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {snoozed}
        </p>
      )}
    </li>
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
        if (!res.ok) throw new Error("Ophalen mislukt");
        return res.json() as Promise<DiffData>;
      })
      .then((page) => {
        if (!cancelled) setData(page);
      })
      .catch(() => {
        if (!cancelled) setError("Wijzigingen ophalen mislukt.");
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
        <h2 className="text-lg font-bold">Wijzigingen</h2>
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

  const hasChanges =
    diff !== undefined &&
    (newFindings.length > 0 ||
      regressedFindings.length > 0 ||
      totalCount(diff.resolved) > 0);

  if (!diff || !hasChanges) return null;

  return (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Wijzigingen</h2>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-400">
            {totalCount(diff.new)} nieuw
          </span>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
            {totalCount(diff.resolved)} opgelost
          </span>
          <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-semibold text-violet-400">
            {totalCount(diff.regressed)} teruggekeerd
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Vergeleken met de laatste schone scan (geen open kritieke/ernstige
        bevindingen of een score ≥ 80).
      </p>

      {newFindings.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-300">Nieuw</h3>
          <ul className="mt-2 space-y-2">
            {newFindings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} kind="new" />
            ))}
          </ul>
        </div>
      )}

      {regressedFindings.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-300">Teruggekeerd</h3>
          <ul className="mt-2 space-y-2">
            {regressedFindings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} kind="regressed" />
            ))}
          </ul>
        </div>
      )}

      {totalCount(diff.resolved) > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-300">Opgelost</h3>
          <div className="mt-2">
            <SeverityChips counts={diff.resolved} />
          </div>
          <p className="mt-1 text-[10px] text-slate-600">
            Deze bevindingen staan niet meer in de laatste scan.
          </p>
        </div>
      )}
    </section>
  );
}