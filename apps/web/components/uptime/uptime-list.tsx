"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { UptimeSummary } from "@scanpal/shared";
import {
  ArrowRight,
  GlobeHemisphereWest,
  Pulse,
  Timer,
  WarningCircle,
} from "@phosphor-icons/react";
import { StatusDot } from "./status-dot";
import { Sparkline } from "./sparkline";
import {
  downSinceLabel,
  formatDateTime,
  formatLatency,
  formatUptimePct,
  hostOf,
} from "@/lib/uptime-format";

type Props = {
  initial: UptimeSummary[];
};

const REFRESH_INTERVAL_MS = 30000;
function hasFreshProbe(site: UptimeSummary): boolean {
  return site.uptime_enabled && site.probe_fresh;
}

export function UptimeList({ initial }: Props) {
  const [summaries, setSummaries] = useState<UptimeSummary[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/uptime");
      if (!res.ok) {
        setError("Availability refresh failed. Showing the last successful probe data.");
        return;
      }
      const data = await res.json();
      if (data?.sites) {
        setSummaries(data.sites);
        setError(null);
      }
    } catch {
      setError("Availability refresh failed. Showing the last successful snapshot.");
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function toggleMonitoring(site: UptimeSummary) {
    setBusyId(site.site_id);
    setError(null);
    try {
      const res = await fetch(`/api/uptime/sites/${site.site_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !site.uptime_enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Wijzigen mislukt");
        return;
      }
      setSummaries((prev) =>
        prev.map((s) =>
          s.site_id === site.site_id
            ? { ...s, uptime_enabled: !site.uptime_enabled }
            : s,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  const monitoredCount = summaries.filter((site) => site.uptime_enabled).length;
  const onlineCount = summaries.filter(
    (site) => hasFreshProbe(site) && site.uptime_state === "up",
  ).length;
  const outageCount = summaries.filter(
    (site) => hasFreshProbe(site) && site.uptime_state === "down",
  ).length;
  const latestProbeAt = summaries
    .filter((site) => site.uptime_enabled && site.last_checked_at)
    .map((site) => site.last_checked_at as string)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

  return (
    <section className="uptime-board">
      {error && (
        <div className="workspace-alert is-error" role="alert">
          <WarningCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {summaries.length === 0 ? (
        <div className="uptime-empty-state">
          <span><Pulse size={24} aria-hidden="true" /></span>
          <div>
            <strong>No endpoints to monitor</strong>
            <p>Add a property first, then enable availability monitoring here.</p>
          </div>
          <Link href="/sites" className="dashboard-primary-button">
            Manage sites <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <div className="uptime-summary-strip" aria-label="Availability summary">
            <div><span>Online now</span><strong>{onlineCount}</strong></div>
            <div className={outageCount > 0 ? "is-danger" : undefined}><span>Confirmed outages</span><strong>{outageCount}</strong></div>
            <div><span>Monitoring enabled</span><strong>{monitoredCount}</strong></div>
            <p><Timer size={17} aria-hidden="true" /> Latest probe {formatDateTime(latestProbeAt)}.</p>
          </div>

          <div className="uptime-ledger">
            <div className="uptime-ledger-heading">
              <div><h2>Endpoint health</h2><p>Current state and the evidence behind it.</p></div>
              <span>Latest successful snapshot</span>
            </div>
            <div className="uptime-site-list">
              {summaries.map((site) => {
                const freshProbe = hasFreshProbe(site);
                const downSince = freshProbe
                  ? downSinceLabel(site.uptime_state, site.uptime_state_changed_at)
                  : null;
                return (
                  <article key={site.site_id} className="uptime-site-row">
                    <div className="uptime-site-identity">
                      <span><GlobeHemisphereWest size={20} aria-hidden="true" /></span>
                      <div>
                        <Link href={`/uptime/${site.site_id}`}>{site.label ?? hostOf(site.url)}</Link>
                        <small>{site.url}</small>
                      </div>
                    </div>
                    <div className="uptime-current-state">
                      <span>Current state</span>
                      {!site.uptime_enabled ? (
                        <>
                          <strong className="uptime-paused-status">Paused</strong>
                          <small>Live checks are off</small>
                        </>
                      ) : freshProbe ? (
                        <>
                          <StatusDot state={site.uptime_state} />
                          {downSince && <small>{downSince}</small>}
                        </>
                      ) : (
                        <>
                          <strong className="uptime-stale-status">Stale</strong>
                          <small>{site.last_checked_at ? `Last probe ${formatDateTime(site.last_checked_at)}` : "No completed probes"}</small>
                        </>
                      )}
                    </div>
                    <dl className="uptime-metrics">
                      <div><dt>24h uptime</dt><dd>{formatUptimePct(site.uptime_24h_pct)}</dd></div>
                      <div><dt>30d uptime</dt><dd>{formatUptimePct(site.uptime_30d_pct)}</dd></div>
                      <div><dt>Avg. latency</dt><dd>{formatLatency(site.avg_latency_ms_24h)}</dd></div>
                    </dl>
                    <div className="uptime-history">
                      <span>24h signal</span>
                      <Sparkline points={site.sparkline} />
                    </div>
                    <label className="uptime-monitor-control">
                      <span>Monitor</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={site.uptime_enabled}
                        aria-label={`Monitor ${site.url}`}
                        onClick={() => toggleMonitoring(site)}
                        disabled={busyId === site.site_id}
                        className={site.uptime_enabled ? "is-enabled" : undefined}
                      ><span /></button>
                    </label>
                  </article>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
