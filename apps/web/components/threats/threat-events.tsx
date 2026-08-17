"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ThreatEvent,
  ThreatEventsResponse,
  ThreatHoneypotView,
  ThreatRisk,
} from "@scanpal/shared";
import { RiskBadge } from "./risk-badge";
import { formatDateTime, hostOf } from "@/lib/uptime-format";

type Props = {
  honeypots: ThreatHoneypotView[];
};

function EventRow({ event }: { event: ThreatEvent }) {
  return (
    <tr className="border-b border-slate-800/60 last:border-b-0">
      <td className="px-5 py-3 text-slate-400">
        {formatDateTime(event.created_at)}
      </td>
      <td className="px-5 py-3">
        <span className="font-medium text-slate-200">
          {event.kind === "pattern" ? "Patroon" : "Hit"}
        </span>
        {event.matched_rule && (
          <span className="ml-2 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300">
            {event.matched_rule}
          </span>
        )}
      </td>
      <td className="px-5 py-3">
        <RiskBadge risk={event.risk} />
      </td>
      <td className="px-5 py-3 font-mono text-xs text-slate-300">{event.path}</td>
      <td className="px-5 py-3 font-mono text-xs text-slate-400">
        {event.ip ?? "—"}
      </td>
      <td className="max-w-[240px] truncate px-5 py-3 text-xs text-slate-500">
        {event.user_agent ?? "—"}
      </td>
    </tr>
  );
}

export function ThreatEvents({ honeypots }: Props) {
  const [events, setEvents] = useState<ThreatEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [risk, setRisk] = useState<ThreatRisk | "">("");
  const [kind, setKind] = useState<ThreatEvent["kind"] | "">("");
  const [siteId, setSiteId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (risk) params.set("risk", risk);
      if (kind) params.set("kind", kind);
      if (siteId) params.set("site_id", siteId);

      const res = await fetch(`/api/threats/events?${params.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Ophalen mislukt");
        return;
      }
      const parsed = data as ThreatEventsResponse;
      setEvents(parsed.events);
      setTotal(parsed.total);
    } finally {
      setLoading(false);
    }
  }, [page, risk, kind, siteId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-400">
          Ernst
          <select
            value={risk}
            onChange={(e) => {
              setRisk(e.target.value as ThreatRisk | "");
              setPage(1);
            }}
            className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">Alle</option>
            <option value="critical">Kritiek</option>
            <option value="high">Hoog</option>
            <option value="medium">Middel</option>
            <option value="low">Laag</option>
          </select>
        </label>
        <label className="text-sm text-slate-400">
          Type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ThreatEvent["kind"] | "");
              setPage(1);
            }}
            className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">Alle</option>
            <option value="pattern">Patroon</option>
            <option value="hit">Hit</option>
          </select>
        </label>
        <label className="text-sm text-slate-400">
          Site
          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPage(1);
            }}
            className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">Alle</option>
            {honeypots.map((h) => (
              <option key={h.site_id} value={h.site_id}>
                {h.site_label ?? hostOf(h.site_url)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {loading && events.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Laden…</p>
      ) : events.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          Nog geen events in dit overzicht.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Tijd</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Ernst</th>
                <th className="px-5 py-3 font-medium">Pad</th>
                <th className="px-5 py-3 font-medium">IP</th>
                <th className="px-5 py-3 font-medium">User-agent</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Vorige
        </button>
        <span>
          Pagina {page} van {totalPages} ({total} events)
        </span>
        <button
          type="button"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Volgende →
        </button>
      </div>
    </div>
  );
}
