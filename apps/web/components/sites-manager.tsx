"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addSiteInputSchema,
  detectGithubRepoFromUrl,
  type SiteWithStatus,
} from "@scanpal/shared";

type Props = {
  sites: SiteWithStatus[];
  githubEnabled: boolean;
  schedulingEnabled: boolean;
  /** Plan 52: actieve vulnerability-tests (Pro-feature). */
  activeTestsEnabled: boolean;
  isOwner: boolean;
};

type FormErrors = {
  url?: string;
  github_repo?: string;
  label?: string;
};

type Upsell = { plan: string; error: string } | null;

const ACTIVE_SCAN = new Set(["queued", "running"]);

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

const SCHEDULE_LABELS: Record<string, string> = {
  none: "Geen",
  daily: "Dagelijks",
  weekly: "Wekelijks",
};

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (score >= 50) return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}

export function SitesManager({
  sites: initialSites,
  githubEnabled,
  schedulingEnabled,
  activeTestsEnabled,
  isOwner,
}: Props) {
  const [sites, setSites] = useState(initialSites);
  const [url, setUrl] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [label, setLabel] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repoHint, setRepoHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<SiteWithStatus | null>(null);
  const [upsell, setUpsell] = useState<Upsell>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editRepo, setEditRepo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTests, setActiveTests] = useState(false);

  function runValidation(): FormErrors {
    const parsed = addSiteInputSchema.safeParse({
      url,
      github_repo: githubRepo,
      label: label || undefined,
    });
    const errors: FormErrors = {};
    for (const issue of parsed.error?.issues ?? []) {
      const key = issue.path[0] as keyof FormErrors;
      if (key !== undefined && !errors[key]) errors[key] = issue.message;
    }
    return errors;
  }

  function onChangeUrl(value: string) {
    setUrl(value);
    const detected = detectGithubRepoFromUrl(value);
    if (detected) {
      setGithubRepo(detected);
      setRepoHint(
        `GitHub-repo herkend als ${detected} — vul ook een website-URL in`,
      );
    } else {
      setRepoHint(null);
    }
    const errors = runValidation();
    if (showErrors) setFieldErrors(errors);
    else setFieldErrors((prev) => ({ ...prev, url: undefined }));
  }

  function onChangeGithub(value: string) {
    setGithubRepo(value);
    setRepoHint(null);
    const errors = runValidation();
    if (showErrors) setFieldErrors(errors);
    else setFieldErrors((prev) => ({ ...prev, github_repo: undefined }));
  }

  function onChangeLabel(value: string) {
    setLabel(value);
    const errors = runValidation();
    if (showErrors) setFieldErrors(errors);
    else setFieldErrors((prev) => ({ ...prev, label: undefined }));
  }

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sites");
    if (!res.ok) return;
    const data = await res.json();
    if (data?.sites) setSites(data.sites);
  }, []);

  const hasActiveScan = sites.some(
    (s) => s.last_scan_status !== null && ACTIVE_SCAN.has(s.last_scan_status),
  );

  useEffect(() => {
    if (!hasActiveScan) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [hasActiveScan, refresh]);

  async function scanSite(site: SiteWithStatus) {
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: site.id,
          active_tests: activeTests,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        return;
      }
      if (res.status === 402) {
        setUpsell({ plan: "pro", error: data?.error ?? "Scan-limiet bereikt" });
        return;
      }
      if (!res.ok) {
        setFormError(data?.error ?? "Scan starten mislukt");
        return;
      }
      setDuplicate(null);
      setNotice("Scan gestart");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function changeSchedule(site: SiteWithStatus, frequency: string) {
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        return;
      }
      if (!res.ok) {
        setFormError(data?.error ?? "Schema wijzigen mislukt");
        return;
      }
      setNotice(
        frequency === "none"
          ? "Geplande scans uitgezet"
          : `Geplande scans ingesteld (${SCHEDULE_LABELS[frequency]})`,
      );
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    setDuplicate(null);
    const errors = runValidation();
    setShowErrors(true);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          github_repo: githubRepo || undefined,
          label: label || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        setFormError(data.error);
        return;
      }
      if (res.status === 409) {
        if (data?.site) setDuplicate(data.site);
        setFormError(data?.error ?? "Deze site staat al op je lijst");
        return;
      }
      if (!res.ok) {
        throw new Error(data?.error ?? "Opslaan mislukt");
      }
      setUrl("");
      setGithubRepo("");
      setLabel("");
      setShowErrors(false);
      setFieldErrors({});
      setNotice(`"${hostOf(data.site.url)}" toegevoegd`);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(site: SiteWithStatus) {
    setEditingId(site.id);
    setEditLabel(site.label ?? "");
    setEditRepo(site.github_repo ?? "");
    setFormError(null);
    setNotice(null);
  }

  async function saveEdit(site: SiteWithStatus) {
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel || null,
          github_repo: editRepo || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        setFormError(data.error);
        return;
      }
      if (!res.ok) {
        setFormError(data?.error ?? "Wijzigen mislukt");
        return;
      }
      setEditingId(null);
      setNotice("Site bijgewerkt");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeSite(site: SiteWithStatus) {
    const name = site.label ?? hostOf(site.url);
    if (!window.confirm(`Verwijder "${name}" en alle scans van deze site?`)) return;
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFormError(data?.error ?? "Verwijderen mislukt");
        return;
      }
      setSites((prev) => prev.filter((s) => s.id !== site.id));
      setNotice("Site verwijderd");
    } finally {
      setBusyId(null);
    }
  }

  async function upgrade() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: upsell?.plan ?? "pro" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Checkout starten mislukt");
      window.location.assign(data.url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Checkout starten mislukt");
      setUpgrading(false);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {(formError || notice) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            formError
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {formError ?? notice}
        </div>
      )}

      {duplicate && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <span className="font-medium">{hostOf(duplicate.url)}</span> staat al op
          je lijst.{" "}
          <button
            type="button"
            onClick={() => scanSite(duplicate)}
            disabled={busyId === duplicate.id}
            className="font-semibold underline underline-offset-2 hover:text-amber-300 disabled:opacity-50"
          >
            {busyId === duplicate.id ? "Starten…" : "Toch scannen"}
          </button>
        </div>
      )}

      <form
        onSubmit={submit}
        className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6"
      >
        <h2 className="font-semibold">Website toevoegen</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">Website URL</span>
            <input
              type="text"
              required
              value={url}
              onChange={(e) => onChangeUrl(e.target.value)}
              placeholder="voorbeeld.nl"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            />
            {showErrors && fieldErrors.url && (
              <span className="mt-1 block text-xs text-red-400">
                {fieldErrors.url}
              </span>
            )}
            {repoHint && (
              <span className="mt-1 block text-xs text-amber-400">
                {repoHint}
              </span>
            )}
          </label>
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
              GitHub-repo
              {!githubEnabled && (
                <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                  Pro
                </span>
              )}
            </span>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => onChangeGithub(e.target.value)}
              disabled={!githubEnabled}
              placeholder="owner/repo"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="mt-1 block text-xs text-slate-500">
              {githubEnabled
                ? "bijv. owner/repo of https://github.com/owner/repo"
                : "Beschikbaar op Pro: scan repositories op geheimen en kwetsbaarheden."}
            </span>
            {showErrors && fieldErrors.github_repo && (
              <span className="mt-1 block text-xs text-red-400">
                {fieldErrors.github_repo}
              </span>
            )}
          </label>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-300">
            Label (optioneel)
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => onChangeLabel(e.target.value)}
            placeholder="bijv. Productie-webshop"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          />
          {showErrors && fieldErrors.label && (
            <span className="mt-1 block text-xs text-red-400">
              {fieldErrors.label}
            </span>
          )}
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
        >
          {submitting ? "Toevoegen…" : "Site toevoegen"}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Sites</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={activeTests}
            disabled={!activeTestsEnabled}
            onChange={(e) => {
              if (!activeTestsEnabled) {
                setUpsell({
                  plan: "pro",
                  error:
                    "Actieve vulnerability-tests zijn alleen beschikbaar op Pro.",
                });
                return;
              }
              setActiveTests(e.target.checked);
            }}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-brand disabled:cursor-not-allowed disabled:opacity-50"
          />
          Actieve tests (Pro)
          {!activeTestsEnabled && (
            <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
              Pro
            </span>
          )}
        </label>
      </div>

      {sites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
          <p className="font-medium">Nog geen sites</p>
          <p className="mt-1 text-sm text-slate-400">
            Voeg je eerste website hierboven toe om te beginnen met scannen.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Site</th>
                <th className="px-5 py-3 font-medium">GitHub-repo</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Score</th>
                <th className="px-5 py-3 font-medium">Laatste scan</th>
                <th className="px-5 py-3 font-medium">Schema</th>
                <th className="px-5 py-3 font-medium">Volgende run</th>
                <th className="px-5 py-3 font-medium">Uptime</th>
                <th className="px-5 py-3 font-medium text-right">Acties</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr
                  key={site.id}
                  className="border-b border-slate-800/60 last:border-b-0"
                >
                  <td className="px-5 py-4">
                    {editingId === site.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="Label"
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-brand"
                        />
                        <input
                          type="text"
                          value={editRepo}
                          onChange={(e) => setEditRepo(e.target.value)}
                          placeholder="owner/repo"
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-brand"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(site)}
                            disabled={busyId === site.id}
                            className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-brand/90 disabled:opacity-50"
                          >
                            Opslaan
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-slate-700 px-3 py-1 text-xs hover:border-slate-500"
                          >
                            Annuleren
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Link
                          href={`/sites/${site.id}`}
                          className="font-medium text-slate-200 transition hover:text-brand"
                        >
                          {site.label ?? hostOf(site.url)}
                        </Link>
                        <p className="text-xs text-slate-500">{site.url}</p>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {site.github_repo ? (
                      <a
                        href={`https://github.com/${site.github_repo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-brand hover:text-brand"
                      >
                        {site.github_repo}
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {!site.last_scan_status && (
                      <span className="text-slate-500">Nog niet gescand</span>
                    )}
                    {site.last_scan_status === "queued" && (
                      <span className="inline-flex items-center gap-2 text-brand">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                        Scannen…
                      </span>
                    )}
                    {site.last_scan_status === "running" && (
                      <span className="inline-flex items-center gap-2 text-brand">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                        Scannen…
                      </span>
                    )}
                    {site.last_scan_status === "completed" && (
                      <span className="text-emerald-400">Klaar</span>
                    )}
                    {site.last_scan_status === "failed" && (
                      <span className="text-red-400">Scan mislukt</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {site.last_scan_score !== null ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${scoreColor(site.last_scan_score)}`}
                        >
                          {site.last_scan_score}
                        </span>
                        {site.last_scan_id && (
                          <Link
                            href={`/scans/${site.last_scan_id}`}
                            className="text-xs text-slate-400 underline-offset-2 hover:text-brand hover:underline"
                          >
                            Bekijk
                          </Link>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-400">
                    {formatDate(site.last_scanned_at)}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <select
                        value={site.scan_frequency}
                        onChange={(e) => changeSchedule(site, e.target.value)}
                        disabled={busyId === site.id}
                        aria-label={`Schema voor ${site.url}`}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 outline-none transition focus:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="none">Geen</option>
                        <option value="daily">Dagelijks</option>
                        <option value="weekly">Wekelijks</option>
                      </select>
                      {!schedulingEnabled && (
                        <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                          Pro
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs text-slate-400">
                    {site.scan_frequency !== "none"
                      ? formatDateTime(site.next_scan_at)
                      : "—"}
                  </td>
                  <td className="px-5 py-4">
                    {site.uptime_state === "up" ? (
                      <Link
                        href={`/uptime/${site.id}`}
                        className="text-emerald-400 underline-offset-2 hover:underline"
                      >
                        Online
                      </Link>
                    ) : site.uptime_state === "down" ? (
                      <Link
                        href={`/uptime/${site.id}`}
                        className="text-red-400 underline-offset-2 hover:underline"
                      >
                        Offline
                      </Link>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => scanSite(site)}
                        disabled={busyId === site.id}
                        className="font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        {busyId === site.id ? "Starten…" : "Scannen"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          editingId === site.id
                            ? setEditingId(null)
                            : startEdit(site)
                        }
                        className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
                      >
                        Bewerken
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => removeSite(site)}
                          disabled={busyId === site.id}
                          className="text-slate-400 underline-offset-2 hover:text-red-400 hover:underline disabled:opacity-50"
                        >
                          Verwijderen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {upsell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8">
            <h2 className="text-xl font-bold">Functie vereist Pro</h2>
            <p className="mt-2 text-sm text-slate-400">{upsell.error}</p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={upgrade}
                disabled={upgrading}
                className="flex-1 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
              >
                {upgrading ? "Bezig…" : "Upgrade naar Pro"}
              </button>
              <button
                type="button"
                onClick={() => setUpsell(null)}
                disabled={upgrading}
                className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold transition hover:border-slate-500 disabled:opacity-50"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
