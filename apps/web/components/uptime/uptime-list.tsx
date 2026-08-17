"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { UptimeSummary } from "@scanpal/shared";
import { StatusDot } from "./status-dot";
import { Sparkline } from "./sparkline";
import {
  downSinceLabel,
  formatLatency,
  formatUptimePct,
  hostOf,
} from "@/lib/uptime-format";

type Props = {
  initial: UptimeSummary[];
};

const REFRESH_INTERVAL_MS = 30000;

export function UptimeList({ initial }: Props) {
  const [summaries, setSummaries] = useState<UptimeSummary[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/uptime");
    if (!res.ok) return;
    const data = await res.json();
    if (data?.sites) setSummaries(data.sites);
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

  return (
    <div className="mt-8 space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {summaries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
          <p className="font-medium">Nog geen sites</p>
          <p className="mt-1 text-sm text-slate-400">
            Voeg eerst een site toe om uptime te volgen.
          </p>
          <Link
            href="/sites"
            className="mt-4 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Naar sites
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Site</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Uptime 24u</th>
                <th className="px-5 py-3 font-medium">Uptime 30d</th>
                <th className="px-5 py-3 font-medium">Gem. latency</th>
                <th className="px-5 py-3 font-medium">24u</th>
                <th className="px-5 py-3 font-medium">Monitoring</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((site) => {
                const downSince = downSinceLabel(
                  site.uptime_state,
                  site.uptime_state_changed_at,
                );
                return (
                  <tr
                    key={site.site_id}
                    className="border-b border-slate-800/60 last:border-b-0"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/uptime/${site.site_id}`}
                        className="font-medium text-slate-200 underline-offset-2 hover:text-brand hover:underline"
                      >
                        {site.label ?? hostOf(site.url)}
                      </Link>
                      <p className="text-xs text-slate-500">{site.url}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusDot state={site.uptime_state} />
                      {downSince && (
                        <p className="mt-1 text-xs text-red-400">{downSince}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {formatUptimePct(site.uptime_24h_pct)}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {formatUptimePct(site.uptime_30d_pct)}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {formatLatency(site.avg_latency_ms_24h)}
                    </td>
                    <td className="px-5 py-4">
                      <Sparkline points={site.sparkline} />
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={site.uptime_enabled}
                        aria-label={`Monitoring voor ${site.url}`}
                        onClick={() => toggleMonitoring(site)}
                        disabled={busyId === site.site_id}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          site.uptime_enabled ? "bg-brand" : "bg-slate-700"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                            site.uptime_enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
