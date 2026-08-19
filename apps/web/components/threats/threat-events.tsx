"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ThreatEvent,
  ThreatEventsResponse,
  ThreatHoneypotView,
  ThreatRisk,
} from "@scanpal/shared";
import { RiskBadge } from "./risk-badge";
import { formatDateTime, hostOf } from "@/lib/uptime-format";
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  FunnelSimple,
  Robot,
} from "@phosphor-icons/react";

type Props = {
  honeypots: ThreatHoneypotView[];
};

function EventRow({ event }: { event: ThreatEvent }) {
  return (
    <article className="threat-event-row">
      <span className={`threat-event-icon is-${event.kind}`}>
        {event.kind === "pattern" ? <Robot size={18} aria-hidden="true" /> : <Crosshair size={18} aria-hidden="true" />}
      </span>
      <div className="threat-event-kind">
        <strong>{event.kind === "pattern" ? "Pattern" : "Direct hit"}</strong>
        {event.matched_rule && (
          <small>{event.matched_rule}</small>
        )}
      </div>
      <RiskBadge risk={event.risk} />
      <div className="threat-event-path"><span>Path</span><code>{event.path}</code></div>
      <div className="threat-event-source"><span>Source</span><code>{event.ip ?? "—"}</code><small>{event.user_agent ?? "Unknown user agent"}</small></div>
      <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
    </article>
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
  const requestController = useRef<AbortController | null>(null);

  const pageSize = 25;

  const load = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    setEvents([]);
    setTotal(0);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (risk) params.set("risk", risk);
      if (kind) params.set("kind", kind);
      if (siteId) params.set("site_id", siteId);

      const res = await fetch(`/api/threats/events?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (requestController.current !== controller) return;
      if (!res.ok) {
        setError(data?.error ?? "Ophalen mislukt");
        setEvents([]);
        setTotal(0);
        return;
      }
      const parsed = data as ThreatEventsResponse;
      setEvents(parsed.events);
      setTotal(parsed.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (requestController.current === controller) {
        setError("Incident evidence could not be refreshed.");
        setEvents([]);
        setTotal(0);
      }
    } finally {
      if (requestController.current === controller) setLoading(false);
    }
  }, [page, risk, kind, siteId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      requestController.current?.abort();
    };
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="threat-events-ledger">
      <div className="threat-filter-bar">
        <FunnelSimple size={17} aria-hidden="true" />
        <label>
          <span>Severity</span>
          <select
            value={risk}
            onChange={(e) => {
              setRisk(e.target.value as ThreatRisk | "");
              setPage(1);
            }}
          >
            <option value="">All levels</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          <span>Signal</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ThreatEvent["kind"] | "");
              setPage(1);
            }}
          >
            <option value="">All signals</option>
            <option value="pattern">Pattern</option>
            <option value="hit">Direct hit</option>
          </select>
        </label>
        <label>
          <span>Property</span>
          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All properties</option>
            {honeypots.map((h) => (
              <option key={h.site_id} value={h.site_id}>
                {h.site_label ?? hostOf(h.site_url)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="workspace-alert is-error" role="alert">{error}</p>}

      {loading && events.length === 0 ? (
        <div className="threat-events-loading" role="status">Loading incident evidence…</div>
      ) : events.length === 0 ? (
        <div className="threat-events-empty">
          No events match this view. Broaden a filter or wait for new evidence.
        </div>
      ) : (
        <div className={`threat-event-list${loading ? " is-loading" : ""}`} aria-busy={loading}>
          {events.map((event) => <EventRow key={event.id} event={event} />)}
        </div>
      )}

      <div className="threat-pagination">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          <ArrowLeft size={15} aria-hidden="true" /> Previous
        </button>
        <span>
          Page {page} of {totalPages} · {total} events
        </span>
        <button
          type="button"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
