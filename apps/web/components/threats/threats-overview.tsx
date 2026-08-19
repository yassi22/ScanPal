"use client";

import { useState } from "react";
import type { ThreatHoneypotView, ThreatOverview } from "@scanpal/shared";
import { RiskBadge } from "./risk-badge";
import { formatDateTime, hostOf } from "@/lib/uptime-format";
import {
  Check,
  Code,
  Copy,
  GlobeHemisphereWest,
  Key,
  ShieldChevron,
  WarningCircle,
} from "@phosphor-icons/react";

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
    <article className="honeypot-row">
      <div className="honeypot-identity">
        <span><GlobeHemisphereWest size={20} aria-hidden="true" /></span>
        <div>
          <strong>{site.site_label ?? hostOf(site.site_url)}</strong>
          <small>{site.site_url}</small>
        </div>
      </div>

      <div className="honeypot-toggle">
        <span>{site.enabled ? "Listening" : "Paused"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={site.enabled}
          aria-label={`${site.enabled ? "Pause" : "Enable"} honeypot for ${site.site_url}`}
          onClick={() => save({ enabled: !site.enabled, rotate_token: false })}
          disabled={busy}
          className={site.enabled ? "is-enabled" : undefined}
        ><span /></button>
      </div>

      <dl className="honeypot-signals">
        <div><dt>Total hits</dt><dd>{site.hit_count}</dd></div>
        <div><dt>High or critical</dt><dd>{overview.high_risk_count}</dd></div>
        <div>
          <dt>Latest event</dt>
          {overview.last_event ? (
            <dd className="honeypot-latest-event">
              <RiskBadge risk={overview.last_event.risk} />
              <small>{formatDateTime(overview.last_event.created_at)}</small>
            </dd>
          ) : (
            <dd>—</dd>
          )}
        </div>
        <div>
          <dt>Active patterns · 24h</dt>
          {overview.active_patterns.length > 0 ? (
            <dd className="honeypot-patterns">
              {overview.active_patterns.map((key) => (
                <span key={key}>{key}</span>
              ))}
            </dd>
          ) : (
            <dd>—</dd>
          )}
        </div>
      </dl>

      {error && (
        <p className="honeypot-error" role="alert"><WarningCircle size={16} aria-hidden="true" /> {error}</p>
      )}

      <div className="honeypot-actions">
        <button
          type="button"
          onClick={() => setShowSnippet((v) => !v)}
          className="is-secondary"
        >
          <Code size={16} aria-hidden="true" /> {showSnippet ? "Hide snippet" : "Install snippet"}
        </button>
        <button
          type="button"
          onClick={() => save({ enabled: site.enabled, rotate_token: true })}
          disabled={busy}
          className="is-secondary"
        >
          <Key size={16} aria-hidden="true" /> Rotate token
        </button>
        <button
          type="button"
          onClick={copySnippet}
          className="is-primary"
        >
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? "Copied" : "Copy private URL"}
        </button>
      </div>

      {showSnippet && (
        <div className="honeypot-snippet">
          <p>
            Place this hidden link in your site footer. Never expose the private
            route as a visible or indexed link.
          </p>
          <pre>
            {"<!-- ScanPal honeypot (verborgen) -->\n"}
            {`<a href="${site.url}" rel="nofollow" aria-hidden="true" style="display:none">.</a>`}
          </pre>
        </div>
      )}
    </article>
  );
}

export function ThreatsOverview({ initial }: Props) {
  const [overviews, setOverviews] = useState<ThreatOverview[]>(initial);

  function update(index: number, next: ThreatOverview) {
    setOverviews((prev) => prev.map((o, i) => (i === index ? next : o)));
  }

  const activeCount = overviews.filter((overview) => overview.site.enabled).length;
  const hitCount = overviews.reduce((sum, overview) => sum + overview.site.hit_count, 0);
  const highRiskCount = overviews.reduce((sum, overview) => sum + overview.high_risk_count, 0);

  return (
    <section className="threat-honeypot-section">
      {overviews.length === 0 ? (
        <div className="threat-empty-state">
          <span><ShieldChevron size={24} aria-hidden="true" /></span>
          <div><strong>No honeypots available</strong><p>Add a site to create its private detection route.</p></div>
        </div>
      ) : (
        <>
          <div className="threat-summary-strip">
            <div><span>Listening</span><strong>{activeCount}</strong></div>
            <div><span>Recorded hits</span><strong>{hitCount}</strong></div>
            <div className={highRiskCount > 0 ? "is-danger" : undefined}><span>High-risk signals</span><strong>{highRiskCount}</strong></div>
            <p><ShieldChevron size={17} aria-hidden="true" /> Private routes stay unique per property.</p>
          </div>
          <div className="workspace-section-heading honeypot-section-heading">
            <div><h2>Honeypot endpoints</h2><p>Configure listening state, inspect signal volume, and copy the install route.</p></div>
          </div>
          <div className="honeypot-list">
            {overviews.map((overview, index) => (
              <HoneypotCard key={overview.site.honeypot_id} overview={overview} onChanged={(next) => update(index, next)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
