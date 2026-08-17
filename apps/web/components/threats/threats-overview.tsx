"use client";

import { useState } from "react";
import type { ThreatHoneypotView, ThreatOverview } from "@scanpal/shared";
import { RiskBadge } from "./risk-badge";
import { formatDateTime, hostOf } from "@/lib/uptime-format";

type Props = {
  initial: ThreatOverview[];
};

function HoneypotCard({
  overview,
  onChanged,
}: {
  overview: ThreatOverview;
  onChanged: (next: ThreatOverview) => void;
}) {
  const { site } = overview;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSnippet, setShowSnippet] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(patch: { enabled: boolean; rotate_token: boolean }) {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/sites/${site.site_id}/honeypot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Opslaan mislukt");
        return;
      }
      const nextHoneypot = data?.honeypot as ThreatHoneypotView;
      onChanged({ ...overview, site: nextHoneypot });
      if (patch.rotate_token) setShowSnippet(true);
    } finally {
      setBusy(false);
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(site.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopiëren mislukt — kopieer de URL handmatig");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-bold text-slate-100">
            {site.site_label ?? hostOf(site.site_url)}
          </p>
          <p className="text-sm text-slate-400">{site.site_url}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={site.enabled}
          aria-label={`Honeypot voor ${site.site_url} ${site.enabled ? "uitzetten" : "aanzetten"}`}
          onClick={() => save({ enabled: !site.enabled, rotate_token: false })}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            site.enabled ? "bg-brand" : "bg-slate-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              site.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Hits</p>
          <p className="mt-1 text-xl font-bold text-slate-100">{site.hit_count}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Hoog/kritiek
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100">
            {overview.high_risk_count}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Laatste event
          </p>
          {overview.last_event ? (
            <div className="mt-1 space-y-1">
              <RiskBadge risk={overview.last_event.risk} />
              <p className="text-xs text-slate-500">
                {formatDateTime(overview.last_event.created_at)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-500">—</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Actieve patronen (24u)
          </p>
          {overview.active_patterns.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {overview.active_patterns.map((key) => (
                <span
                  key={key}
                  className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300"
                >
                  {key}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-500">—</p>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowSnippet((v) => !v)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          {showSnippet ? "Snippet verbergen" : "Install-snippet"}
        </button>
        <button
          type="button"
          onClick={() => save({ enabled: site.enabled, rotate_token: true })}
          disabled={busy}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Token roteren
        </button>
        <button
          type="button"
          onClick={copySnippet}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
        >
          {copied ? "Gekopieerd!" : "Honeypot-URL kopiëren"}
        </button>
      </div>

      {showSnippet && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-500">
            Plaats deze verborgen link ergens op je site (bijv. in de footer).
            De URL zelf mag nooit publiek gelinkt worden.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
            {"<!-- ScanPal honeypot (verborgen) -->\n"}
            {`<a href="${site.url}" rel="nofollow" aria-hidden="true" style="display:none">.</a>`}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ThreatsOverview({ initial }: Props) {
  const [overviews, setOverviews] = useState<ThreatOverview[]>(initial);

  function update(index: number, next: ThreatOverview) {
    setOverviews((prev) => prev.map((o, i) => (i === index ? next : o)));
  }

  return (
    <div className="mt-8 space-y-6">
      {overviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
          <p className="font-medium">Nog geen honeypots</p>
          <p className="mt-1 text-sm text-slate-400">
            Zet per site de honeypot aan om probes te detecteren. Elke site
            krijgt een eigen geheime URL.
          </p>
        </div>
      ) : (
        overviews.map((overview, index) => (
          <HoneypotCard
            key={overview.site.honeypot_id}
            overview={overview}
            onChanged={(next) => update(index, next)}
          />
        ))
      )}
    </div>
  );
}
