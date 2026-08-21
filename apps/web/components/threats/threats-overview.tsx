"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ThreatHoneypotView, ThreatOverview } from "@scanpal/shared";
import type { ThreatCreatableSite } from "@/lib/threats-core";
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
  creatable: ThreatCreatableSite[];
};

function HoneypotCard({
  overview,
  onChanged,
  initialShowSnippet = false,
}: {
  overview: ThreatOverview;
  onChanged: (next: ThreatOverview) => void;
  initialShowSnippet?: boolean;
}) {
  const { site } = overview;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSnippet, setShowSnippet] = useState(initialShowSnippet);
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

function CreatableRow({
  site,
  busy,
  error,
  onCreate,
}: {
  site: ThreatCreatableSite;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  return (
    <article className="honeypot-creatable-row">
      <div className="honeypot-identity">
        <span><GlobeHemisphereWest size={20} aria-hidden="true" /></span>
        <div>
          <strong>{site.site_label ?? hostOf(site.site_url)}</strong>
          <small>{site.site_url}</small>
        </div>
      </div>

      <button
        type="button"
        className="honeypot-create-button"
        onClick={onCreate}
        disabled={busy}
      >
        <ShieldChevron size={16} aria-hidden="true" />
        {busy ? "Creating…" : "Create honeypot"}
      </button>

      {error && (
        <p className="honeypot-error" role="alert"><WarningCircle size={16} aria-hidden="true" /> {error}</p>
      )}
    </article>
  );
}

export function ThreatsOverview({ initial, creatable: initialCreatable }: Props) {
  const router = useRouter();
  const [overviews, setOverviews] = useState<ThreatOverview[]>(initial);
  const [creatable, setCreatable] = useState<ThreatCreatableSite[]>(initialCreatable);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  function update(index: number, next: ThreatOverview) {
    setOverviews((prev) => prev.map((o, i) => (i === index ? next : o)));
  }

  async function createHoneypot(site: ThreatCreatableSite) {
    setBusyId(site.site_id);
    setErrors((prev) => ({ ...prev, [site.site_id]: "" }));
    try {
      const res = await fetch(`/api/sites/${site.site_id}/honeypot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, rotate_token: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [site.site_id]: data?.error ?? "Aanmaken mislukt",
        }));
        return;
      }
      const honeypot = data?.honeypot as ThreatHoneypotView;
      const created: ThreatOverview = {
        site: honeypot,
        last_event: null,
        high_risk_count: 0,
        active_patterns: [],
      };
      setJustCreatedId(honeypot.honeypot_id);
      setOverviews((prev) => [created, ...prev]);
      setCreatable((prev) => prev.filter((s) => s.site_id !== site.site_id));
      // Ververst de server-gerenderde honeypot-teller in de paginakop.
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = overviews.filter((overview) => overview.site.enabled).length;
  const hitCount = overviews.reduce((sum, overview) => sum + overview.site.hit_count, 0);
  const highRiskCount = overviews.reduce((sum, overview) => sum + overview.high_risk_count, 0);

  return (
    <section className="threat-honeypot-section">
      {overviews.length === 0 && creatable.length === 0 ? (
        <div className="threat-empty-state">
          <span><ShieldChevron size={24} aria-hidden="true" /></span>
          <div><strong>No honeypots available</strong><p>Add a site to create its private detection route.</p></div>
        </div>
      ) : (
        <>
          {overviews.length > 0 && (
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
                  <HoneypotCard
                    key={overview.site.honeypot_id}
                    overview={overview}
                    initialShowSnippet={overview.site.honeypot_id === justCreatedId}
                    onChanged={(next) => update(index, next)}
                  />
                ))}
              </div>
            </>
          )}

          {creatable.length > 0 && (
            <div className="honeypot-creatable">
              <div className="workspace-section-heading honeypot-section-heading">
                <div>
                  <h2>{overviews.length === 0 ? "Create your first honeypot" : "Sites without a honeypot yet"}</h2>
                  <p>Each property gets a private, hidden detection route. Turn one on to start collecting signals.</p>
                </div>
              </div>
              <div className="honeypot-creatable-list">
                {creatable.map((site) => (
                  <CreatableRow
                    key={site.site_id}
                    site={site}
                    busy={busyId === site.site_id}
                    error={errors[site.site_id] || null}
                    onCreate={() => createHoneypot(site)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
