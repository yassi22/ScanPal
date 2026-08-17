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
        if (!r.ok) throw new Error("ophalen mislukt");
        return (await r.json()) as Response;
      })
      .then((json) => {
        if (active) setData(json);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "fout");
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold">Domein</h2>
        <p className="mt-2 text-sm text-slate-400">
          Domein-status niet beschikbaar: {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold">Domein</h2>
        <p className="mt-2 text-sm text-slate-500">Laden…</p>
      </div>
    );
  }

  const { status, events } = data;
  const expiryDays = daysUntil(status.domain_expiry);
  const tlsDays = daysUntil(status.tls_expiry);
  const neverChecked = !status.last_checked_at;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Domein</h2>
        {status.last_checked_at && (
          <span className="text-xs text-slate-500">
            laatst gemeten {formatDateTime(status.last_checked_at)}
          </span>
        )}
      </div>

      {neverChecked ? (
        <p className="text-sm text-slate-400">
          Nog geen domein-meting. Start een scan of wacht op de dagelijkse watch.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card
              label="Domein verloopt"
              value={expiryDays === null ? "onbekend" : `over ${expiryDays} d`}
              tone={countdownTone(expiryDays, 30)}
              sub={status.domain_registrar ? `registrar: ${status.domain_registrar}` : "registrar onbekend"}
            />
            <Card
              label="TLS-certificaat verloopt"
              value={tlsDays === null ? "onbekend" : `over ${tlsDays} d`}
              tone={countdownTone(tlsDays, 14)}
              sub={status.tls_expiry ? formatDateTime(status.tls_expiry) : "niet gemeten"}
            />
            <Card
              label="DNSSEC"
              value={status.dnssec_enabled === null ? "onbekend" : status.dnssec_enabled ? "aan" : "uit"}
              tone={status.dnssec_enabled ? "ok" : status.dnssec_enabled === false ? "warn" : "neutral"}
            />
            <Card
              label="CAA"
              value={status.caa_present === null ? "onbekend" : status.caa_present ? "aanwezig" : "afwezig"}
              tone={status.caa_present ? "ok" : "neutral"}
            />
          </div>

          {status.nameservers && status.nameservers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Nameservers</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {status.nameservers.map((ns) => (
                  <li
                    key={ns}
                    className="rounded-md bg-slate-800/60 px-2 py-0.5 font-mono text-xs text-slate-300"
                  >
                    {ns}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-300">
              Wijzigingsgeschiedenis
            </h3>
            {events.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Geen wijzigingen gedetecteerd sinds de eerste meting.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start justify-between gap-3 rounded-md bg-slate-800/30 px-3 py-1.5 text-xs"
                  >
                    <span className="text-slate-300">
                      <span className="font-medium text-slate-200">{eventLabel(e.field)}</span>
                      {": "}
                      <span className="text-slate-400">{e.old_value ?? "—"}</span>
                      {" → "}
                      <span className="text-slate-200">{e.new_value ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-slate-500">
                      {formatDateTime(e.checked_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
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
  const toneClass =
    tone === "ok"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-red-400"
          : "text-slate-300";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
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
  return new Date(value).toLocaleString("nl-NL", {
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
    caa_present: "CAA aanwezig",
    tls_expiry: "TLS-expiry",
    nameservers: "Nameservers",
    caa_records: "CAA-records",
  };
  return labels[field] ?? field;
}
