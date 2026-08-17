"use client";

import type { UptimeDetail } from "@scanpal/shared";
import { StatusDot } from "./status-dot";
import { UptimeChart } from "./uptime-chart";
import {
  formatDateTime,
  formatLatency,
  formatUptimePct,
  hostOf,
  incidentDuration,
} from "@/lib/uptime-format";

type Props = {
  siteId: string;
  initial: UptimeDetail;
};

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function UptimeDetailView({ siteId, initial }: Props) {
  const { summary, recent_events: events, last_incident: incident } = initial;

  const incidentLabel = incident
    ? incident.ended_at === null
      ? "Lopend"
      : incidentDuration(incident.started_at, incident.ended_at)
    : "Geen";

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <StatusDot state={summary.uptime_state} />
        <div>
          <p className="text-lg font-bold text-slate-100">
            {summary.label ?? hostOf(summary.url)}
          </p>
          <p className="text-sm text-slate-400">{summary.url}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Uptime 24u"
          value={formatUptimePct(summary.uptime_24h_pct)}
        />
        <Metric
          label="Uptime 30d"
          value={formatUptimePct(summary.uptime_30d_pct)}
        />
        <Metric
          label="Gem. latency 24u"
          value={formatLatency(summary.avg_latency_ms_24h)}
          hint={
            summary.p95_latency_ms_24h !== null
              ? `p95: ${formatLatency(summary.p95_latency_ms_24h)}`
              : null
          }
        />
        <Metric
          label="Laatste incident"
          value={incidentLabel}
          hint={incident ? formatDateTime(incident.started_at) : null}
        />
      </div>

      <UptimeChart siteId={siteId} initial={initial} />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Laatste checks</h2>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nog geen checks. De poller probeert elke 60 seconden.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800/60 text-sm">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      event.status === "up" ? "bg-emerald-400" : "bg-red-500"
                    }`}
                    aria-hidden
                  />
                  <span>
                    {event.status === "up" ? "Up" : "Down"}
                    {event.error && (
                      <span className="ml-2 text-xs text-slate-500">
                        {event.error}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-6 text-xs text-slate-400">
                  {event.status_code !== null && <span>{event.status_code}</span>}
                  <span>{formatLatency(event.latency_ms)}</span>
                  <span className="w-28 text-right">
                    {formatDateTime(event.checked_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
