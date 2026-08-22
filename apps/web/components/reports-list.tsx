"use client";

import { useState } from "react";
import { type ReportMeta } from "@scanpal/shared";
import {
  ArrowDown,
  DownloadSimple,
  FilePdf,
  FileText,
  FunnelSimple,
  GlobeHemisphereWest,
} from "@phosphor-icons/react";

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
  return new Date(iso).toLocaleString("en-GB", {
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
  const pdfCount = reports.filter((report) => report.format === "pdf").length;
  const markdownCount = reports.length - pdfCount;

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
    <div className="reports-library">
      <header className="dashboard-page-heading reports-page-heading">
        <div>
          <h1>Reports, ready to share.</h1>
          <p>
            Your generated PDF and Markdown evidence, organized by property and
            kept close to the scan that produced it.
          </p>
        </div>
        <span className="dashboard-plan-chip">
          {reports.length} {reports.length === 1 ? "report" : "reports"}
        </span>
      </header>

      <section className="reports-toolbar" aria-label="Report filters and summary">
        <div className="reports-summary" aria-label="Visible report types">
          <span><FilePdf size={18} aria-hidden="true" /> {pdfCount} PDF</span>
          <span><FileText size={18} aria-hidden="true" /> {markdownCount} Markdown</span>
        </div>
        <label className="reports-filter">
          <FunnelSimple size={17} aria-hidden="true" />
          <span>Property</span>
          <select
            value={siteId}
            onChange={(event) => load(event.target.value)}
            disabled={loading}
            aria-label="Filter reports by property"
          >
            <option value="">All sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label ?? site.url}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <p className="workspace-alert is-error" role="alert">
          {error}
        </p>
      )}

      <section className={`reports-archive${loading ? " is-loading" : ""}`} aria-busy={loading}>
        <div className="reports-archive-heading">
          <div>
            <h2>{siteId ? "Filtered archive" : "Report archive"}</h2>
            <p>Exports are immutable snapshots of a completed scan.</p>
          </div>
          {loading && <span className="reports-loading">Updating…</span>}
        </div>

        {reports.length === 0 ? (
          <div className="reports-empty-state">
            <span className="reports-empty-icon"><FileText size={22} aria-hidden="true" /></span>
            <div>
              <strong>No reports yet</strong>
              <p>Export a PDF or Markdown report from a completed scan to build this archive.</p>
            </div>
          </div>
        ) : (
          <ul className="reports-list">
            {reports.map((report) => {
              const site = siteById.get(report.site_id);
              return (
                <li key={report.id} className="report-row">
                  <span className={`report-format-icon is-${report.format}`}>
                    {report.format === "pdf" ? (
                      <FilePdf size={20} aria-hidden="true" />
                    ) : (
                      <FileText size={20} aria-hidden="true" />
                    )}
                  </span>
                  <div className="report-file">
                    <strong>{report.filename}</strong>
                    <span>
                      <GlobeHemisphereWest size={13} aria-hidden="true" />
                      {site?.label ?? site?.url ?? "Unknown site"}
                    </span>
                  </div>
                  <div className="report-meta">
                    <span>{formatDate(report.created_at)}</span>
                    <span>{formatBytes(report.size_bytes)}</span>
                  </div>
                  <a
                    href={`/api/reports/${report.id}/content`}
                    className="report-download"
                    aria-label={`Download ${report.filename}`}
                  >
                    <DownloadSimple size={17} aria-hidden="true" />
                    <span>Download</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <div className="reports-pagination">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="dashboard-light-button"
            >
              <ArrowDown size={16} aria-hidden="true" />
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
        {(loading || loadingMore) && !nextCursor && (
          <p className="reports-loading-note">Loading reports…</p>
        )}
      </section>
    </div>
  );
}
