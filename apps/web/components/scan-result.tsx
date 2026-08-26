"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  ArrowLeft,
  DownloadSimple,
  LinkSimple,
} from "@phosphor-icons/react";
import {
  AI_ENGINE_BOTS,
  categoryLabels,
  checksForCategory,
  COMPLIANCE_DISCLAIMER,
  computeCruxDivergences,
  scanCategories,
  SCORE_EXCLUDED_CHECK_IDS,
  type CategoryProgress,
  type CruxData,
  type CwvEvidence,
  type EngineMatrixEvidence,
  type Finding,
  type LabCwv,
  type ScanCategory,
  type SeverityCounts,
} from "@scanpal/shared";
import { useScanProgress, type ScanViewState } from "@/lib/use-scan-progress";
import { FindingsPanel } from "./findings-panel";
import { DiffPanel } from "./diff-panel";

type Props = {
  scanId: string;
  siteId: string;
  siteUrl: string;
  siteLabel: string | null;
  initial: ScanViewState;
  needsOnboarding: boolean;
};

const SEVERITY_LABELS: Record<keyof SeverityCounts, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const SEVERITY_COLORS: Record<keyof SeverityCounts, string> = {
  critical: "bg-red-500/15 text-red-400",
  high: "bg-orange-500/15 text-orange-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-slate-500/15 text-slate-300",
  info: "bg-sky-500/15 text-sky-400",
};

function ActiveTestsSection({ items }: { items: Finding[] }) {
  const active = items.filter((item) => item.active);
  if (active.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-brand/30 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Active tests</h2>
        <span className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-0.5 text-[10px] font-semibold text-brand">
          Pro
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Active vulnerability tests (opt-in). These findings do not count toward
        the overall score.
      </p>

      <ul className="mt-4 space-y-2">
        {active.map((finding) => (
          <li
            key={finding.id}
            className="rounded-xl border border-slate-800 bg-slate-950/60"
          >
            <details className="group">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[finding.severity]}`}
                >
                  {SEVERITY_LABELS[finding.severity]}
                </span>
                <span className="flex-1 text-sm font-semibold text-slate-200">
                  {finding.title}
                </span>
                <span className="text-xs text-slate-500">
                  {categoryLabels[finding.category]}
                </span>
              </summary>
              <div className="space-y-4 border-t border-slate-800 px-4 py-4">
                <p className="text-sm text-slate-300">{finding.description}</p>
                {finding.evidence &&
                  typeof finding.evidence !== "string" &&
                  "request" in finding.evidence && (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Request
                        </p>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                          {finding.evidence.request}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Response
                        </p>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                          {finding.evidence.response}
                        </pre>
                      </div>
                    </div>
                  )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Remediation
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {finding.remediation}
                  </p>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function isEngineMatrixEvidence(
  evidence: Finding["evidence"],
): evidence is EngineMatrixEvidence {
  return (
    evidence !== null &&
    typeof evidence === "object" &&
    "kind" in evidence &&
    evidence.kind === "aeo-engine-matrix"
  );
}

/**
 * AEO per-engine matrix (plan 55): één finding met `engine_matrix` + llms.txt-
 * status. Toont 7 AI-engines met bereikbaarheid, parseerbaarheid en reden.
 * Indicatief-signaal: een UA-probe zegt niet alles (Google gebruikt bijv. IP-
 * allowlists); vandaar het "Indicatief"-label.
 */
function EngineMatrixSection({ items }: { items: Finding[] }) {
  const finding = items.find(
    (item) => item.check_id === "aeo-engine-matrix" && !item.active,
  );
  if (!finding || !isEngineMatrixEvidence(finding.evidence)) return null;

  const { engine_matrix, llms_txt } = finding.evidence;
  const byEngine = new Map(engine_matrix.map((row) => [row.engine, row]));

  return (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">AEO engine-matrix</h2>
        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-400">
          Indicative
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Proxy measurement: whether AI crawlers (based on their bot UA) can reach
        the site and parse core content without JavaScript. A UA probe is
        indicative — some engines also use IP allowlists.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="py-2 pr-4 font-semibold">Engine</th>
              <th className="py-2 pr-4 font-semibold">Reachable</th>
              <th className="py-2 pr-4 font-semibold">Parseable</th>
              <th className="py-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {AI_ENGINE_BOTS.map((bot) => {
              const row = byEngine.get(bot.engine);
              return (
                <tr
                  key={bot.engine}
                  className="border-b border-slate-800/60 align-top"
                >
                  <td className="py-2 pr-4 font-medium text-slate-200">
                    {bot.name}
                  </td>
                  <td className="py-2 pr-4">
                    <ReachBadge ok={row?.reachable ?? false} />
                  </td>
                  <td className="py-2 pr-4">
                    <ParseBadge ok={row?.parseable ?? false} />
                  </td>
                  <td className="py-2 text-xs text-slate-400">
                    {row?.reason ?? "not tested"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <p className="text-xs font-semibold text-slate-400">llms.txt</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          {llms_txt.present ? (
            <>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                Present
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  llms_txt.parseable
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                }`}
              >
                {llms_txt.parseable ? "Parseable" : "Not parseable"}
              </span>
              {llms_txt.link_errors.length > 0 && (
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                  {llms_txt.link_errors.length} invalid link(s)
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full border border-slate-600 bg-slate-800/60 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
              Absent
            </span>
          )}
        </div>
        {llms_txt.link_errors.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-red-400">
            {llms_txt.link_errors.slice(0, 10).map((link, index) => (
              <li key={`${link}-${index}`} className="truncate">
                {link}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ComplianceSection({ items }: { items: Finding[] }) {
  const compliance = items.filter(
    (item) => item.category === "compliance" && !item.active,
  );
  if (compliance.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Compliance & privacy</h2>
        <span className="rounded-full border border-slate-600 bg-slate-800/60 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300">
          Indicative
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{COMPLIANCE_DISCLAIMER}</p>
      <p className="mt-3 text-xs text-slate-400">
        Passive detection based on the public HTML — the site is not touched
        and no cookies are set. Open each finding&apos;s details for an explanation
        of why it is a signal.
      </p>
    </section>
  );
}

function isCwvEvidence(evidence: Finding["evidence"]): evidence is CwvEvidence {
  return (
    evidence !== null &&
    typeof evidence === "object" &&
    "kind" in evidence &&
    evidence.kind === "core-web-vitals"
  );
}

const CRUX_VITALS = [
  { key: "lcp", label: "LCP", name: "Largest Contentful Paint" },
  { key: "inp", label: "INP", name: "Interaction to Next Paint" },
  { key: "cls", label: "CLS", name: "Cumulative Layout Shift" },
] as const;

type CruxVitalKey = (typeof CRUX_VITALS)[number]["key"];

function vitalLabValue(lab: LabCwv, key: CruxVitalKey): number | null {
  if (key === "lcp") return lab.lcp_ms;
  if (key === "inp") return lab.inp_ms;
  return lab.cls;
}

function formatVital(value: number | null, key: CruxVitalKey): string {
  if (value === null) return "—";
  if (key === "cls") return String(value);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

function FractionBar({
  good,
  ni,
  poor,
}: {
  good: number | null;
  ni: number | null;
  poor: number | null;
}) {
  const segments = [
    { value: good ?? 0, className: "bg-emerald-500" },
    { value: ni ?? 0, className: "bg-amber-500" },
    { value: poor ?? 0, className: "bg-red-500" },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
      {segments.map((segment, index) => (
        <div
          key={index}
          className={segment.className}
          style={{ width: `${Math.max((segment.value / total) * 100, segment.value > 0 ? 2 : 0)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Plan 62 — CrUX field data: lab vs field side-by-side per vital (p75 +
 * good/needs-improvement/poor-fracties van echte Chrome-gebruikers) met een
 * divergentie-badge waar lab en field boven de drempel afwijken. Geen
 * CrUX-dekking → uitleg in plaats van een score-straf (besluit 3).
 */
function CruxSection({ items, crux }: { items: Finding[]; crux: CruxData | null }) {
  const finding = items.find(
    (item) => item.check_id === "core-web-vitals" && !item.active,
  );
  const lab: LabCwv | null =
    finding && isCwvEvidence(finding.evidence)
      ? {
          lcp_ms: finding.evidence.lcp_ms,
          cls: finding.evidence.cls,
          inp_ms: finding.evidence.inp_ms,
        }
      : null;

  if (!lab && !crux) return null;

  const divergences = computeCruxDivergences(lab, crux);
  const divergedVitals = new Set(divergences.map((d) => d.vital));

  return (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Performance: lab vs field</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-400">
            Field data (CrUX)
          </span>
          {divergences.length > 0 && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400">
              {divergences.length} divergence(s) — see findings
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Lab = Playwright measurement in this scan; field = p75 from real
        Chrome users (Chrome UX Report, period {crux?.collection_period ?? "—"}).
        Google ranks on field data, not lab guesses.
      </p>

      {!crux && (
        <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
          No field data available — CrUX only covers sufficiently visited
          origins (low traffic or new domain). No score penalty.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="py-2 pr-4 font-semibold">Vital</th>
              <th className="py-2 pr-4 font-semibold">Lab</th>
              <th className="py-2 pr-4 font-semibold">Field p75</th>
              <th className="py-2 pr-4 font-semibold">Field fractions</th>
              <th className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {CRUX_VITALS.map(({ key, label, name }) => {
              const metric = crux?.metrics[key];
              const labValue = lab ? vitalLabValue(lab, key) : null;
              return (
                <tr key={key} className="border-b border-slate-800/60 align-middle">
                  <td className="py-2.5 pr-4">
                    <p className="font-semibold text-slate-200">{label}</p>
                    <p className="text-xs text-slate-500">{name}</p>
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-slate-300">
                    {formatVital(labValue, key)}
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-slate-200">
                    {metric ? formatVital(metric.p75, key) : "—"}
                  </td>
                  <td className="py-2.5 pr-4">
                    {metric ? (
                      <div className="max-w-56 space-y-1">
                        <FractionBar
                          good={metric.good}
                          ni={metric.needs_improvement}
                          poor={metric.poor}
                        />
                        <p className="text-[10px] text-slate-500">
                          good {Math.round((metric.good ?? 0) * 100)}% · ni{" "}
                          {Math.round((metric.needs_improvement ?? 0) * 100)}% · poor{" "}
                          {Math.round((metric.poor ?? 0) * 100)}%
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {divergedVitals.has(key) ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                        Diverging
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReachBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
      Yes
    </span>
  ) : (
    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-400">
      No
    </span>
  );
}

function ParseBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
      Yes
    </span>
  ) : (
    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
      No
    </span>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (score >= 50) return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}

function scanScoreTone(score: number): string {
  if (score >= 80) return "is-good";
  if (score >= 50) return "is-warning";
  return "is-critical";
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-brand border-t-transparent ${
        small ? "h-3 w-3" : "h-4 w-4"
      }`}
    />
  );
}

function StatusBadge({ status }: { status: ScanViewState["status"] }) {
  if (status === "completed") {
    return (
      <span className="scan-status is-completed">
        Complete
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="scan-status is-failed">
        Failed
      </span>
    );
  }
  if (status === "canceled") {
    return (
      <span className="scan-status is-canceled">
        Canceled
      </span>
    );
  }
  return (
    <span className="scan-status is-running">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
      {status === "queued" ? "Queued" : "Scanning…"}
    </span>
  );
}

function ExportMenu({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [includePrompts, setIncludePrompts] = useState(false);

  function close() {
    setOpen(false);
    router.refresh();
  }

  const promptParam = includePrompts ? "&include_prompts=1" : "";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`scan-export-menu-${scanId}`}
        className="scan-secondary-button rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
      >
        <DownloadSimple size={17} aria-hidden="true" />
        Export
      </button>
      {open && (
        <div
          id={`scan-export-menu-${scanId}`}
          className="scan-export-menu absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-lg"
        >
          <a
            href={`/api/reports/${scanId}?format=pdf${promptParam}`}
            onClick={close}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            PDF report
            <span className="text-xs text-slate-500">.pdf</span>
          </a>
          <a
            href={`/api/reports/${scanId}?format=md${promptParam}`}
            onClick={close}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Markdown
            <span className="text-xs text-slate-500">.md</span>
          </a>
          <label className="flex items-center gap-2 border-t border-slate-800 px-4 py-2.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={includePrompts}
              onChange={(event) => setIncludePrompts(event.target.checked)}
              className="accent-brand"
            />
            Include AI fix-prompts
          </label>
        </div>
      )}
    </div>
  );
}

function ShareReportButton({ scanId }: { scanId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function share() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/reports/${scanId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Failed to create link");
      await navigator.clipboard.writeText(data.url);
      setMessage("Link copied");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        disabled={loading}
        className="scan-secondary-button rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
      >
        <LinkSimple size={17} aria-hidden="true" />
        {loading ? "Creating link…" : "Public link"}
      </button>
      {message && (
        <span className="text-xs text-slate-400" role="status" aria-live="polite">
          {message}
        </span>
      )}
    </div>
  );
}

function CategoryCard({
  category,
  progress,
}: {
  category: ScanCategory;
  progress: CategoryProgress | undefined;
}) {
  const checks = checksForCategory(category);
  const active = progress !== undefined && progress.total > 0;
  const percent = active ? progress.percent : 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-200">{categoryLabels[category]}</h3>
        <div className="flex items-center gap-2">
          {progress?.status === "running" && <Spinner small />}
          {progress?.status === "done" && active && (
            <span className="text-sm text-emerald-400">✓</span>
          )}
          <span className="text-sm font-semibold text-slate-300">
            {active ? `${percent}%` : "—"}
          </span>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            progress?.status === "done" ? "bg-emerald-400" : "bg-brand"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="mt-4 space-y-2">
        {checks.map((check, index) => {
          if (!active) {
            return (
              <li
                key={check.id}
                className="flex items-center gap-2 text-xs text-slate-600"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                {check.name}
              </li>
            );
          }
          const done = index < progress.done;
          const isCurrent = !done && progress.current_check === check.name;
          return (
            <li
              key={check.id}
              className={`flex items-center gap-2 text-xs ${
                done
                  ? "text-slate-300"
                  : isCurrent
                    ? "text-brand"
                    : "text-slate-500"
              }`}
            >
              {done ? (
                <span className="text-emerald-400">✓</span>
              ) : isCurrent ? (
                <Spinner small />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
              )}
              {check.name}
              {isCurrent && (
                <span className="ml-auto animate-pulse text-[10px] uppercase tracking-wide text-brand">
                  running
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!active && (
        <p className="mt-3 text-[10px] text-slate-600">
          No checks in this run
        </p>
      )}
    </div>
  );
}

function ProgressView({ state }: { state: ScanViewState }) {
  const details = state.progressDetails;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">
            {state.status === "queued" ? "Queued…" : "Running checks…"}
          </span>
          <span className="font-semibold text-brand">{state.progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${state.progress}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {details
            ? `${details.checks_done}/${details.checks_total} checks completed`
            : "Setting up…"}
        </p>
        {state.routeCount !== null && state.routeCount > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            {state.routeCount} route(s) discovered
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {scanCategories.map((category) => (
          <CategoryCard
            key={category}
            category={category}
            progress={details?.categories?.[category]}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryScore({
  category,
  items,
}: {
  category: ScanCategory;
  items: Finding[];
}) {
  const relevant = items.filter(
    (item) =>
      item.category === category &&
      !item.active &&
      !SCORE_EXCLUDED_CHECK_IDS.has(item.check_id),
  );
  if (relevant.length === 0) {
    return (
      <div className="scan-category-item rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <p className="text-xs font-semibold text-slate-400">
          {categoryLabels[category]}
        </p>
        <p className="mt-1 text-xs text-slate-600">No checks run</p>
      </div>
    );
  }
  const passed = relevant.filter((item) => item.severity === "info").length;
  const percent = Math.round((passed / relevant.length) * 100);
  return (
    <div className="scan-category-item rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400">
          {categoryLabels[category]}
        </p>
        <span
          className={`scan-category-score inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${scoreColor(percent)}`}
        >
          {percent}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {passed}/{relevant.length} checks passed
      </p>
    </div>
  );
}

export function ScanResultView({
  scanId,
  siteId,
  siteUrl,
  siteLabel,
  initial,
  needsOnboarding,
}: Props) {
  const router = useRouter();
  const state = useScanProgress(scanId, initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const terminal =
    state.status === "completed" ||
    state.status === "failed" ||
    state.status === "canceled";

  async function cancelScan() {
    setCanceling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(data?.error ?? "Failed to cancel scan");
        return;
      }
      router.refresh();
    } finally {
      setCanceling(false);
      setConfirmingCancel(false);
    }
  }

  async function rescan() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: siteId }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setActionError(data.error);
        return;
      }
      if (!res.ok) {
        setActionError(data?.error ?? "Failed to start scan");
        return;
      }
      router.push(`/scans/${data.scan.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function finishOnboarding() {
    await fetch("/api/onboarding/complete", { method: "POST" });
    router.push("/dashboard");
    router.refresh();
  }

  const findingsItems = (Array.isArray(state.findings.items)
    ? state.findings.items
    : []) as Finding[];
  const legacyFindings = Array.isArray(state.findings.checks);
  const blockingFindings =
    (state.summary?.critical ?? 0) + (state.summary?.high ?? 0);
  const completedLabel = state.completedAt
    ? new Date(state.completedAt).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const scoreHeading =
    (state.score ?? 0) >= 80
      ? "Healthy foundation"
      : (state.score ?? 0) >= 50
        ? "Improvements recommended"
        : "Needs immediate attention";

  return (
    <div className="scan-detail-page">
      <header className="scan-detail-header">
        <div className="scan-detail-heading">
          <Link
            href={needsOnboarding ? "/onboarding" : "/sites"}
            className="scan-back-link"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {needsOnboarding ? "Back to onboarding" : "Back to sites"}
          </Link>
          <h1>
            {siteLabel ?? hostOf(siteUrl)}
          </h1>
          <a className="scan-site-url" href={siteUrl} target="_blank" rel="noreferrer">
            {siteUrl}
          </a>
        </div>
        <div className="scan-detail-actions">
          <StatusBadge status={state.status} />
          {state.status === "completed" && (
            <>
              <ShareReportButton scanId={scanId} />
              <ExportMenu scanId={scanId} />
            </>
          )}
        </div>
      </header>

      {terminal ? (
        <div className="scan-terminal-view">
          {state.status === "failed" ? (
            <section className="scan-state-panel scan-state-panel-error">
              <h2>Scan failed</h2>
              <p>
                {state.error ?? "The scan failed. Please try again."}
              </p>
            </section>
          ) : state.status === "canceled" ? (
            <section className="scan-state-panel">
              <h2>Scan canceled</h2>
              <p>
                The scan was canceled and the credit has been refunded.
              </p>
            </section>
          ) : (
            <>
              <div className="scan-overview">
                <section
                  className="scan-result-summary"
                  aria-labelledby="scan-result-heading"
                >
                  <div className="scan-score-block">
                    <div className={`scan-score-value ${scanScoreTone(state.score ?? 0)}`}>
                      <strong>{state.score ?? "—"}</strong>
                      <span>/ 100</span>
                    </div>
                    <div>
                      <h2 id="scan-result-heading">{scoreHeading}</h2>
                      <p>
                        {blockingFindings > 0
                          ? `${blockingFindings} finding${blockingFindings === 1 ? "" : "s"} with high priority require action.`
                          : "No critical or severe findings in this scan."}
                      </p>
                      <a href="#scan-findings" className="scan-primary-link">
                        View findings
                      </a>
                    </div>
                  </div>

                  <dl className="scan-summary-facts">
                    <div>
                      <dt>Findings</dt>
                      <dd>{findingsItems.length}</dd>
                    </div>
                    <div>
                      <dt>Routes</dt>
                      <dd>{state.routeCount ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>{completedLabel ?? "Just now"}</dd>
                    </div>
                  </dl>
                </section>

                {state.summary && (
                  <div className="scan-severity-summary" aria-label="Findings by severity">
                    {(Object.keys(SEVERITY_LABELS) as (keyof SeverityCounts)[]).map(
                      (severity) => (
                        <div
                          key={severity}
                          className={`scan-severity-item is-${severity}${
                            state.summary![severity] === 0 ? " is-zero" : ""
                          }`}
                        >
                          <strong>{state.summary![severity]}</strong>
                          <span>{SEVERITY_LABELS[severity]}</span>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>

              <section className="scan-category-section" aria-labelledby="scan-category-heading">
                <div className="scan-section-heading">
                  <div>
                    <h2 id="scan-category-heading">Coverage by category</h2>
                    <p>Where the foundation is strong and where improvement has the most impact.</p>
                  </div>
                </div>
                <div className="scan-category-grid">
                  {scanCategories.map((category) => (
                    <CategoryScore
                      key={category}
                      category={category}
                      items={findingsItems}
                    />
                  ))}
                </div>
              </section>

              <div className="scan-evidence-stack">
                <ActiveTestsSection items={findingsItems} />
                <DiffPanel scanId={scanId} />
                <CruxSection items={findingsItems} crux={state.crux} />
                <EngineMatrixSection items={findingsItems} />
                <ComplianceSection items={findingsItems} />
              </div>

              <div id="scan-findings" className="scan-findings-anchor">
                <FindingsPanel scanId={scanId} legacy={legacyFindings} />
              </div>
            </>
          )}

          <div className="scan-terminal-actions">
            <button
              type="button"
              onClick={rescan}
              disabled={busy}
              className="scan-rescan-button"
            >
              <ArrowClockwise size={17} aria-hidden="true" />
              {busy ? "Starting…" : state.status === "failed" ? "Retry" : "Rescan"}
            </button>
            {needsOnboarding && (
              <button
                type="button"
                onClick={finishOnboarding}
                className="scan-secondary-button"
              >
                Go to dashboard
              </button>
            )}
            {actionError && (
              <span className="scan-action-error" role="alert">{actionError}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="scan-running-view">
          <ProgressView state={state} />
          <div className="scan-cancel-actions">
            {confirmingCancel ? (
              <>
                <span>
                  Cancel the running scan?
                </span>
                <button
                  type="button"
                  onClick={cancelScan}
                  disabled={canceling}
                  className="scan-danger-button"
                >
                  {canceling ? "Canceling…" : "Yes, cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={canceling}
                  className="scan-secondary-button"
                >
                  No
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                className="scan-secondary-button"
              >
                Cancel scan
              </button>
            )}
            {actionError && (
              <span className="scan-action-error" role="alert">{actionError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
