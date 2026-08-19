"use client";

import { useEffect, useState } from "react";
import type { DomainEvent, DomainStatus } from "@scanpal/shared";

type Props = {
  siteId: string;
};

type Response = {
  status: DomainStatus;
  events: DomainEvent[];
};

/**
 * Plan 56 — domein-kaart op de site-detailpagina. Toont expiry-countdown,
 * registrar, DNSSEC/CAA-badges, TLS-geldig-tot, en de recente events-
 * geschiedenis (nameserver-drift, dnssec-wissel, etc.). Fetcht zelf de
 * `/api/sites/[id]/domain` route (client-side).
 */
export function DomainWatchtowerCard({ siteId }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/sites/${siteId}/domain?limit=20`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Unable to load domain signals.");
        return (await r.json()) as Response;
      })
      .then((json) => {
        if (active) setData(json);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load domain signals.");
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  if (error) {
    return (
      <section className="site-detail-section domain-watchtower">
        <h2>Domain</h2>
        <p className="site-detail-message is-error">
          Domain status is unavailable: {error}
        </p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="site-detail-section domain-watchtower">
        <h2>Domain</h2>
        <p className="site-detail-message" role="status">Loading domain signals…</p>
      </section>
    );
  }

  const { status, events } = data;
  const expiryDays = daysUntil(status.domain_expiry);
  const tlsDays = daysUntil(status.tls_expiry);
  const neverChecked = !status.last_checked_at;

  return (
    <section className="site-detail-section domain-watchtower">
      <div className="site-detail-section-heading">
        <div>
          <h2>Domain</h2>
          <p>Registration, certificate and DNS posture.</p>
        </div>
        {status.last_checked_at && (
          <span>
            Measured {formatDateTime(status.last_checked_at)}
          </span>
        )}
      </div>

      {neverChecked ? (
        <p className="site-detail-message">
          No domain measurement yet. Start a scan or wait for the daily watch.
        </p>
      ) : (
        <>
          <div className="domain-metric-grid">
            <Card
              label="Domain expiry"
              value={expiryDays === null ? "Unknown" : `In ${expiryDays} days`}
              tone={countdownTone(expiryDays, 30)}
              sub={status.domain_registrar ? `Registrar: ${status.domain_registrar}` : "Registrar unknown"}
            />
            <Card
              label="TLS certificate expiry"
              value={tlsDays === null ? "Unknown" : `In ${tlsDays} days`}
              tone={countdownTone(tlsDays, 14)}
              sub={status.tls_expiry ? formatDateTime(status.tls_expiry) : "Not measured"}
            />
            <Card
              label="DNSSEC"
              value={status.dnssec_enabled === null ? "Unknown" : status.dnssec_enabled ? "Enabled" : "Disabled"}
              tone={status.dnssec_enabled ? "ok" : status.dnssec_enabled === false ? "warn" : "neutral"}
            />
            <Card
              label="CAA"
              value={status.caa_present === null ? "Unknown" : status.caa_present ? "Present" : "Missing"}
              tone={status.caa_present ? "ok" : "neutral"}
            />
          </div>

          {status.nameservers && status.nameservers.length > 0 && (
            <div className="domain-nameservers">
              <h3>Nameservers</h3>
              <ul>
                {status.nameservers.map((ns) => (
                  <li key={ns}><code>{ns}</code></li>
                ))}
              </ul>
            </div>
          )}

          <div className="domain-history">
            <h3>Change history</h3>
            {events.length === 0 ? (
              <p>
                No changes detected since the first measurement.
              </p>
            ) : (
              <ul>
                {events.map((e) => (
                  <li key={e.id}>
                    <span>
                      <strong>{eventLabel(e.field)}</strong>
                      {": "}
                      <span>{e.old_value ?? "—"}</span>
                      {" → "}
                      <span>{e.new_value ?? "—"}</span>
                    </span>
                    <time dateTime={e.checked_at}>
                      {formatDateTime(e.checked_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className={`domain-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / 86_400_000);
}

function countdownTone(days: number | null, warnDays: number): "ok" | "warn" | "bad" | "neutral" {
  if (days === null) return "neutral";
  if (days < 0) return "bad";
  if (days < warnDays) return "warn";
  return "ok";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventLabel(field: string): string {
  const labels: Record<string, string> = {
    domain_expiry: "Expiry",
    domain_registrar: "Registrar",
    dnssec_enabled: "DNSSEC",
    caa_present: "CAA presence",
    tls_expiry: "TLS-expiry",
    nameservers: "Nameservers",
    caa_records: "CAA-records",
  };
  return labels[field] ?? field;
}
