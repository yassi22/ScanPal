"use client";

import { useState } from "react";
import { type ReportMeta } from "@scanpal/shared";

type SiteOption = {
  id: string;
  url: string;
  label: string | null;
};

type Props = {
  sites: SiteOption[];
  initialReports: ReportMeta[];
  initialNextCursor: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ReportsList({
  sites,
  initialReports,
  initialNextCursor,
}: Props) {
  const [reports, setReports] = useState<ReportMeta[]>(initialReports);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [siteId, setSiteId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteById = new Map(sites.map((site) => [site.id, site]));

  async function fetchPage(site: string, cursor?: string) {
    const params = new URLSearchParams();
    if (site) params.set("site_id", site);
    if (cursor) params.set("cursor", cursor);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/reports${query}`);
    if (!res.ok) throw new Error("Ophalen mislukt");
    return (await res.json()) as {
      reports: ReportMeta[];
      next_cursor: string | null;
    };
  }

  async function load(site: string) {
    setSiteId(site);
    setLoading(true);
    setError(null);
    setNextCursor(null);
    try {
      const data = await fetchPage(site);
      setReports(data.reports);
      setNextCursor(data.next_cursor);
    } catch {
      setError("Rapporten ophalen mislukt. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchPage(siteId, nextCursor);
      setReports((prev) => [...prev, ...data.reports]);
      setNextCursor(data.next_cursor);
    } catch {
      setError("Meer rapporten laden mislukt. Probeer het opnieuw.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Rapporten</h1>
          <p className="text-sm text-slate-400">
            Opgeslagen PDF- en Markdown-rapporten van je scans.
          </p>
        </div>
        <select
          value={siteId}
          onChange={(event) => load(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300"
        >
          <option value="">Alle sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.label ?? site.url}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50">
        {reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">
            Nog geen rapporten. Exporteer een PDF of Markdown-rapport vanaf een
            scanresultaat.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {reports.map((report) => {
              const site = siteById.get(report.site_id);
              return (
                <li
                  key={report.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      report.format === "pdf"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-sky-500/15 text-sky-400"
                    }`}
                  >
                    {report.format === "pdf" ? "PDF" : "Markdown"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-200">
                      {report.filename}
                    </p>
                    <p className="text-xs text-slate-500">
                      {site?.label ?? site?.url ?? "Onbekende site"} ·{" "}
                      {formatDate(report.created_at)}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatBytes(report.size_bytes)}
                  </span>
                  <a
                    href={`/api/reports/${report.id}/content`}
                    className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
                  >
                    Download
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <div className="px-5 py-4">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
            >
              {loadingMore ? "Laden…" : "Meer laden"}
            </button>
          </div>
        )}
        {(loading || loadingMore) && !nextCursor && (
          <p className="px-5 py-3 text-xs text-slate-500">Laden…</p>
        )}
      </div>
    </div>
  );
}