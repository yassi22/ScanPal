"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AI_ENGINE_BOTS,
  categoryLabels,
  checksForCategory,
  scanCategories,
  type CategoryProgress,
  type EngineMatrixEvidence,
  type Finding,
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
  critical: "Kritiek",
  high: "Hoog",
  medium: "Medium",
  low: "Laag",
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
        <h2 className="text-lg font-bold">Actieve tests</h2>
        <span className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-0.5 text-[10px] font-semibold text-brand">
          Pro
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Actieve vulnerability-tests (opt-in). Deze findings tellen niet mee in
        de overall-score.
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
                          Verzoek
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
                    Remediatie
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
          Indicatief
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Proxy-meting: of AI-crawlers (op basis van hun bot-UA) de site kunnen
        bereiken en de kerncontent zonder JavaScript te parsen is. Een
        UA-probe is indicatief — sommige engines gebruiken ook IP-allowlists.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="py-2 pr-4 font-semibold">Engine</th>
              <th className="py-2 pr-4 font-semibold">Bereikbaar</th>
              <th className="py-2 pr-4 font-semibold">Parseerbaar</th>
              <th className="py-2 font-semibold">Reden</th>
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
                    {row?.reason ?? "niet getest"}
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
                Aanwezig
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  llms_txt.parseable
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                }`}
              >
                {llms_txt.parseable ? "Parseerbaar" : "Niet parseerbaar"}
              </span>
              {llms_txt.link_errors.length > 0 && (
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                  {llms_txt.link_errors.length} ongeldige link(s)
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full border border-slate-600 bg-slate-800/60 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
              Afwezig
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

function ReachBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
      Ja
    </span>
  ) : (
    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-400">
      Nee
    </span>
  );
}

function ParseBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
      Ja
    </span>
  ) : (
    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
      Nee
    </span>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (score >= 50) return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
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
      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
        Voltooid
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400">
        Mislukt
      </span>
    );
  }
  if (status === "canceled") {
    return (
      <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-xs font-semibold text-slate-300">
        Geannuleerd
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
      {status === "queued" ? "In de wachtrij" : "Scannen…"}
    </span>
  );
}

function ExportMenu({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
      >
        Exporteren
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
          <a
            href={`/api/reports/${scanId}?format=pdf`}
            onClick={close}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            PDF rapport
            <span className="text-xs text-slate-500">.pdf</span>
          </a>
          <a
            href={`/api/reports/${scanId}?format=md`}
            onClick={close}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Markdown
            <span className="text-xs text-slate-500">.md</span>
          </a>
        </div>
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
                  bezig
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!active && (
        <p className="mt-3 text-[10px] text-slate-600">
          Geen checks in deze run
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
            {state.status === "queued" ? "In de wachtrij…" : "Checks uitvoeren…"}
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
            ? `${details.checks_done}/${details.checks_total} checks voltooid`
            : "Bezig met opzetten…"}
        </p>
        {state.routeCount !== null && state.routeCount > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            {state.routeCount} route(s) ontdekt
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {scanCategories.map((category) => (
          <CategoryCard
            key={category}
            category={category}
            progress={details?.categories[category]}
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
    (item) => item.category === category && !item.active,
  );
  if (relevant.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <p className="text-xs font-semibold text-slate-400">
          {categoryLabels[category]}
        </p>
        <p className="mt-1 text-xs text-slate-600">Geen checks uitgevoerd</p>
      </div>
    );
  }
  const passed = relevant.filter((item) => item.severity === "info").length;
  const percent = Math.round((passed / relevant.length) * 100);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400">
          {categoryLabels[category]}
        </p>
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${scoreColor(percent)}`}
        >
          {percent}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {passed}/{relevant.length} checks doorstaan
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
        setActionError(data?.error ?? "Scan annuleren mislukt");
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
        setActionError(data?.error ?? "Scan starten mislukt");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={needsOnboarding ? "/onboarding" : "/sites"}
            className="text-xs text-slate-500 transition hover:text-slate-300"
          >
            ← Terug
          </Link>
          <h1 className="mt-1 text-xl font-bold">
            {siteLabel ?? hostOf(siteUrl)}
          </h1>
          <p className="text-sm text-slate-400">{siteUrl}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={state.status} />
          {state.status === "completed" && <ExportMenu scanId={scanId} />}
        </div>
      </div>

      {terminal ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          {state.status === "failed" ? (
            <div>
              <h2 className="text-lg font-bold text-red-400">Scan mislukt</h2>
              <p className="mt-2 text-sm text-slate-400">
                {state.error ?? "De scan is mislukt. Probeer het opnieuw."}
              </p>
            </div>
          ) : state.status === "canceled" ? (
            <div>
              <h2 className="text-lg font-bold text-slate-300">
                Scan geannuleerd
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                De scan is geannuleerd en de credit is teruggeboekt.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-5">
                <div
                  className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold ${scoreColor(state.score ?? 0)}`}
                >
                  {state.score ?? "—"}
                </div>
                <div>
                  <p className="font-semibold">Gezondheidsscore</p>
                  <p className="text-sm text-slate-400">
                    Overall score op basis van {findingsItems.length} findings.
                  </p>
                  {state.summary && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(Object.keys(SEVERITY_LABELS) as (keyof SeverityCounts)[]).map(
                        (severity) =>
                          state.summary![severity] > 0 && (
                            <span
                              key={severity}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[severity]}`}
                            >
                              {state.summary![severity]} {SEVERITY_LABELS[severity]}
                            </span>
                          ),
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {scanCategories.map((category) => (
                  <CategoryScore
                    key={category}
                    category={category}
                    items={findingsItems}
                  />
                ))}
              </div>

              <ActiveTestsSection items={findingsItems} />

              <EngineMatrixSection items={findingsItems} />

              <DiffPanel scanId={scanId} />

              <div className="mt-6">
                <FindingsPanel scanId={scanId} legacy={legacyFindings} />
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={rescan}
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
            >
              {busy ? "Starten…" : state.status === "failed" ? "Opnieuw proberen" : "Opnieuw scannen"}
            </button>
            {needsOnboarding && (
              <button
                type="button"
                onClick={finishOnboarding}
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold transition hover:border-slate-500"
              >
                Naar dashboard
              </button>
            )}
            {actionError && (
              <span className="text-sm text-red-400">{actionError}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <ProgressView state={state} />
          <div className="flex flex-wrap items-center gap-3">
            {confirmingCancel ? (
              <>
                <span className="text-sm text-slate-400">
                  De lopende scan annuleren?
                </span>
                <button
                  type="button"
                  onClick={cancelScan}
                  disabled={canceling}
                  className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:border-red-500 disabled:opacity-50"
                >
                  {canceling ? "Annuleren…" : "Ja, annuleren"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={canceling}
                  className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
                >
                  Nee
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-red-500/50 hover:text-red-400"
              >
                Scan annuleren
              </button>
            )}
            {actionError && (
              <span className="text-sm text-red-400">{actionError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
