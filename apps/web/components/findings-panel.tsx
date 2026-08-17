"use client";

import { useCallback, useEffect, useState } from "react";
import {
  bundleKeyTypeLabels,
  bundleProviderLabels,
  categoryLabels,
  COMPLIANCE_DISCLAIMER,
  severityOrder,
  type BundleSecretEvidence,
  type ComplianceEvidence,
  type EngineMatrixEvidence,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
  type FixPrompt,
  type ScanCategory,
  type SeverityCounts,
} from "@scanpal/shared";

type Props = {
  scanId: string;
  legacy: boolean;
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

const STATUS_LABELS: Record<FindingStatus, string> = {
  open: "Open",
  fixed: "Opgelost",
  ignored: "Genegeerd",
};

const STATUS_COLORS: Record<FindingStatus, string> = {
  open: "text-slate-400",
  fixed: "text-emerald-400",
  ignored: "text-slate-500",
};

type Filters = {
  severity: FindingSeverity | null;
  category: ScanCategory | null;
  status: FindingStatus | null;
  q: string;
  keyType: string | null;
  routeUrl: string | null;
};

type PanelData = {
  findings: Finding[];
  total: number;
  counts: SeverityCounts;
  categories: ScanCategory[];
  key_types: string[];
  routes: string[];
};

const PAGE_SIZE = 50;

function BundleSecretEvidenceView({ evidence }: { evidence: BundleSecretEvidence }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Gevonden in JS-bundels ({evidence.matches.length})
      </p>
      <ul className="space-y-2">
        {evidence.matches.map((match, index) => (
          <li
            key={`${match.file}:${match.match_preview}:${index}`}
            className="rounded-lg border border-slate-800 bg-slate-900 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">
                {bundleProviderLabels[match.provider] ?? match.provider}
              </span>
              <span className="text-xs font-semibold text-slate-200">
                {bundleKeyTypeLabels[match.key_type] ?? match.key_type}
              </span>
              {match.sourcemap && (
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                  via sourcemap
                </span>
              )}
            </div>
            <code className="mt-2 block font-mono text-sm text-amber-300">
              {match.match_preview}
            </code>
            <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
              {match.file}
            </p>
          </li>
        ))}
      </ul>
      {evidence.notes.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Aandachtspunten
          </p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-slate-400">
            {evidence.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EngineMatrixEvidenceNote({
  evidence,
}: {
  evidence: EngineMatrixEvidence;
}) {
  const reachable = evidence.engine_matrix.filter((r) => r.reachable).length;
  const parseable = evidence.engine_matrix.filter((r) => r.parseable).length;
  const llms = evidence.llms_txt.present
    ? `llms.txt aanwezig (parseerbaar: ${evidence.llms_txt.parseable ? "ja" : "nee"})`
    : "llms.txt afwezig";
  return (
    <p className="text-xs text-slate-400">
      {reachable}/{evidence.engine_matrix.length} bots bereikbaar,{" "}
      {parseable}/{evidence.engine_matrix.length} bots parseerbaar; {llms}. De
      volledige per-engine matrix staat bovenaan de resultatenpagina.
    </p>
  );
}

/** Plan 61: compliance-signalen ("waarom is dit een signaal") per bevinding. */
function ComplianceEvidenceNote({
  evidence,
}: {
  evidence: ComplianceEvidence;
}) {
  return (
    <ul className="space-y-1.5">
      {evidence.signals.map((signal) => (
        <li key={signal.signal} className="flex items-start gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span className="text-xs text-slate-300">{signal.detail}</span>
        </li>
      ))}
    </ul>
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

function snoozeDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Clipboard met fallback (navigator.clipboard vereist een secure context). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // valt door naar de fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Plan 60: kopieer-knop per finding — haalt de enkelvoudige fix-prompt op
 * en kopieert die direct naar het klembord.
 */
function CopyFindingPromptButton({
  scanId,
  finding,
}: {
  scanId: string;
  finding: Finding;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/scans/${scanId}/findings/${encodeURIComponent(finding.id)}/prompt`,
      );
      if (!res.ok) throw new Error("Ophalen mislukt");
      const data = (await res.json()) as { prompt: string };
      const ok = await copyToClipboard(data.prompt);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setError("Kopiëren mislukt");
      }
    } catch {
      setError("Prompt ophalen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
      >
        {busy ? "Laden…" : copied ? "Gekopieerd ✓" : "Kopieer prompt"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

/**
 * Plan 60: "Genereer fix-prompt"-knop bovenaan de findings — genereert de
 * gegroepeerde scan-prompt en toont die in een panel met kopieer-knop.
 */
function ScanFixPromptPanel({ scanId }: { scanId: string }) {
  const [prompt, setPrompt] = useState<FixPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/fix-prompt`);
      if (!res.ok) throw new Error("Ophalen mislukt");
      setPrompt((await res.json()) as FixPrompt);
    } catch {
      setError("Fix-prompt genereren mislukt. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!prompt) return;
    const ok = await copyToClipboard(prompt.prompt);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError("Kopiëren mislukt");
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={generate}
        className="rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-50"
      >
        {loading ? "Genereren…" : "Genereer fix-prompt"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {prompt && (
        <div className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fix-prompt (Engels, voor AI-editors)
            </p>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>{prompt.findings_covered} open findings</span>
              {prompt.truncated && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-400">
                  Afgekapt
                </span>
              )}
              <button
                type="button"
                onClick={copy}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-brand/90"
              >
                {copied ? "Gekopieerd ✓" : "Kopieer"}
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={prompt.prompt}
            rows={14}
            className="mt-3 w-full resize-y rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-300"
            aria-label="Fix-prompt"
          />
        </div>
      )}
    </div>
  );
}

export function FindingsPanel({ scanId, legacy }: Props) {
  const [filters, setFilters] = useState<Filters>({
    severity: null,
    category: null,
    status: null,
    q: "",
    keyType: null,
    routeUrl: null,
  });
  const [debouncedQ, setDebouncedQ] = useState("");
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<string | null>(null);
  const [ignoreNote, setIgnoreNote] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      const params = new URLSearchParams();
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.category) params.set("category", filters.category);
      if (filters.status) params.set("status", filters.status);
      if (filters.keyType) params.set("key_type", filters.keyType);
      if (filters.routeUrl) params.set("route_url", filters.routeUrl);
      params.set("active", "false");
      const q = debouncedQ.trim();
      if (q) params.set("q", q);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/scans/${scanId}/findings?${params}`);
        if (!res.ok) throw new Error("Ophalen mislukt");
        const page = (await res.json()) as PanelData;
        setData((prev) => ({
          findings: replace ? page.findings : [...(prev?.findings ?? []), ...page.findings],
          total: page.total,
          counts: page.counts,
          categories: page.categories,
          key_types: page.key_types,
          routes: page.routes,
        }));
      } catch {
        setError("Findings ophalen mislukt. Probeer het opnieuw.");
      } finally {
        setLoading(false);
      }
    },
    [scanId, filters, debouncedQ],
  );

  useEffect(() => {
    const timer = setTimeout(() => void fetchPage(0, true), 0);
    return () => clearTimeout(timer);
  }, [fetchPage]);

  async function changeStatus(finding: Finding, status: FindingStatus, note?: string) {
    setUpdatingId(finding.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/scans/${scanId}/findings/${encodeURIComponent(finding.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(note !== undefined ? { status, note } : { status }),
        },
      );
      if (!res.ok) throw new Error("Bijwerken mislukt");
      setExpandedId(null);
      setIgnoreTarget(null);
      setIgnoreNote("");
      await fetchPage(0, true);
    } catch {
      setError("Status bijwerken mislukt. Probeer het opnieuw.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function snoozeFinding(finding: Finding, snoozeUntil: string | null) {
    setUpdatingId(finding.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/scans/${scanId}/findings/${encodeURIComponent(finding.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snooze_until: snoozeUntil }),
        },
      );
      if (!res.ok) throw new Error("Snooze mislukt");
      await fetchPage(0, true);
    } catch {
      setError("Snooze bijwerken mislukt. Probeer het opnieuw.");
    } finally {
      setUpdatingId(null);
    }
  }

  function toggleSeverity(severity: FindingSeverity) {
    setFilters((prev) => ({
      ...prev,
      severity: prev.severity === severity ? null : severity,
    }));
  }

  const counts = data?.counts ?? {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const findings = data?.findings ?? [];
  const hasFilters =
    filters.severity !== null ||
    filters.category !== null ||
    filters.status !== null ||
    filters.keyType !== null ||
    filters.routeUrl !== null ||
    debouncedQ.trim() !== "";
  const canLoadMore = data !== null && findings.length < data.total;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Findings</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {data ? `${data.total} in deze scan` : "…"}
          </span>
          <ScanFixPromptPanel scanId={scanId} />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {severityOrder.map((severity) => (
            <button
              key={severity}
              type="button"
              onClick={() => toggleSeverity(severity)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                filters.severity === severity
                  ? "ring-1 ring-brand/60"
                  : "hover:opacity-80"
              } ${SEVERITY_COLORS[severity]}`}
            >
              {counts[severity]} {SEVERITY_LABELS[severity]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filters.category ?? ""}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                category: (event.target.value || null) as ScanCategory | null,
              }))
            }
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
          >
            <option value="">Alle categorieën</option>
            {(data?.categories ?? []).map((category) => (
              <option key={category} value={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </select>

          <select
            value={filters.status ?? ""}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                status: (event.target.value || null) as FindingStatus | null,
              }))
            }
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
          >
            <option value="">Alle statussen</option>
            {(Object.keys(STATUS_LABELS) as FindingStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          {(data?.key_types.length ?? 0) > 0 && (
            <select
              value={filters.keyType ?? ""}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  keyType: event.target.value || null,
                }))
              }
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
            >
              <option value="">Alle key-types</option>
              {data!.key_types.map((keyType) => (
                <option key={keyType} value={keyType}>
                  {bundleKeyTypeLabels[keyType as keyof typeof bundleKeyTypeLabels] ?? keyType}
                </option>
              ))}
            </select>
          )}

          {(data?.routes.length ?? 0) > 0 && (
            <select
              value={filters.routeUrl ?? ""}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  routeUrl: event.target.value || null,
                }))
              }
              className="max-w-[16rem] truncate rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
            >
              <option value="">Alle routes</option>
              {data!.routes.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </select>
          )}

          <input
            type="search"
            value={filters.q}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, q: event.target.value }))
            }
            placeholder="Zoek in findings…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 placeholder:text-slate-600 sm:w-64"
          />
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {data && findings.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
          {legacy
            ? "Geen findings — herscan deze site voor het nieuwe findings-formaat."
            : hasFilters
              ? "Geen findings gevonden — filter aanpassen."
              : "Geen findings gevonden."}
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {findings.map((finding) => {
          const expanded = expandedId === finding.id;
          const ignoring = ignoreTarget === finding.id;
          return (
            <li
              key={finding.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60"
            >
              <button
                type="button"
                onClick={() => {
                  setExpandedId(expanded ? null : finding.id);
                  setIgnoreTarget(null);
                }}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[finding.severity]}`}
                >
                  {SEVERITY_LABELS[finding.severity]}
                </span>
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
                <span className={`text-xs ${STATUS_COLORS[finding.status]}`}>
                  {STATUS_LABELS[finding.status]}
                </span>
                {finding.snooze_until && (
                  <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-400">
                    Gesnoozd
                  </span>
                )}
                <span className="text-xs text-slate-600">
                  {expanded ? "−" : "+"}
                </span>
              </button>

              {expanded && (
                <div className="space-y-4 border-t border-slate-800 px-4 py-4">
                  <p className="text-sm text-slate-300">{finding.description}</p>
                  {finding.evidence && (
                    <div className="space-y-2">
                      {typeof finding.evidence === "string" ? (
                        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                          {finding.evidence}
                        </pre>
                      ) : "matches" in finding.evidence ? (
                        <BundleSecretEvidenceView evidence={finding.evidence} />
                      ) : "request" in finding.evidence ? (
                        <>
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
                        </>
                      ) : "kind" in finding.evidence &&
                        finding.evidence.kind === "aeo-engine-matrix" ? (
                        <EngineMatrixEvidenceNote evidence={finding.evidence} />
                      ) : "kind" in finding.evidence &&
                        finding.evidence.kind === "compliance" ? (
                        <ComplianceEvidenceNote evidence={finding.evidence} />
                      ) : null}
                    </div>
                  )}
                  {finding.category === "compliance" && (
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      {COMPLIANCE_DISCLAIMER}
                    </p>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Remediatie
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      {finding.remediation}
                    </p>
                  </div>
                  {finding.note && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Notitie
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        {finding.note}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {finding.status !== "fixed" && (
                      <button
                        type="button"
                        disabled={updatingId === finding.id}
                        onClick={() => changeStatus(finding, "fixed")}
                        className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/25 disabled:opacity-50"
                      >
                        Markeer als opgelost
                      </button>
                    )}
                    {finding.status !== "ignored" && !ignoring && (
                      <button
                        type="button"
                        disabled={updatingId === finding.id}
                        onClick={() => {
                          setIgnoreTarget(finding.id);
                          setIgnoreNote("");
                        }}
                        className="rounded-lg bg-slate-500/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-500/25 disabled:opacity-50"
                      >
                        Negeren
                      </button>
                    )}
                    {ignoring && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={ignoreNote}
                          onChange={(event) => setIgnoreNote(event.target.value)}
                          placeholder="Waarom genegeerd? (optioneel)"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 placeholder:text-slate-600 sm:w-72"
                        />
                        <button
                          type="button"
                          disabled={updatingId === finding.id}
                          onClick={() =>
                            changeStatus(
                              finding,
                              "ignored",
                              ignoreNote.trim() || undefined,
                            )
                          }
                          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
                        >
                          Bevestig
                        </button>
                        <button
                          type="button"
                          onClick={() => setIgnoreTarget(null)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-slate-500"
                        >
                          Annuleren
                        </button>
                      </div>
                    )}
                    {(finding.status === "fixed" || finding.status === "ignored") && (
                      <button
                        type="button"
                        disabled={updatingId === finding.id}
                        onClick={() => changeStatus(finding, "open")}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-slate-500 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                    <CopyFindingPromptButton scanId={scanId} finding={finding} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Snooze-alert
                    </span>
                    {finding.snooze_until ? (
                      <button
                        type="button"
                        disabled={updatingId === finding.id}
                        onClick={() => snoozeFinding(finding, null)}
                        className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-400 transition hover:border-sky-500 disabled:opacity-50"
                      >
                        Snooze opheffen
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={updatingId === finding.id}
                          onClick={() => snoozeFinding(finding, snoozeDays(7))}
                          className="rounded-lg bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-400 transition hover:bg-sky-500/20 disabled:opacity-50"
                        >
                          7 dagen
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === finding.id}
                          onClick={() => snoozeFinding(finding, snoozeDays(30))}
                          className="rounded-lg bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-400 transition hover:bg-sky-500/20 disabled:opacity-50"
                        >
                          30 dagen
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === finding.id}
                          onClick={() => snoozeFinding(finding, "next-scan")}
                          className="rounded-lg bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-400 transition hover:bg-sky-500/20 disabled:opacity-50"
                        >
                          Tot volgende scan
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canLoadMore && (
        <div className="mt-4 text-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => fetchPage(findings.length, false)}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
          >
            {loading ? "Laden…" : "Meer laden"}
          </button>
        </div>
      )}
    </section>
  );
}
