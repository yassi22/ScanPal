"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  CalendarBlank,
  CheckCircle,
  GithubLogo,
  GlobeHemisphereWest,
  Key,
  PencilSimple,
  Play,
  Plus,
  Pulse,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  addSiteInputSchema,
  detectGithubRepoFromUrl,
  ownershipVerificationStatus,
  type SiteWithStatus,
} from "@scanpal/shared";
import { SiteAuthAccount } from "./site-auth-account";

type Props = {
  sites: SiteWithStatus[];
  githubEnabled: boolean;
  schedulingEnabled: boolean;
  /** Plan 52: actieve vulnerability-tests (Pro-feature). */
  activeTestsEnabled: boolean;
  isOwner: boolean;
};

type FormErrors = {
  url?: string;
  github_repo?: string;
  label?: string;
};

type Upsell = { plan: string; error: string } | null;

const ACTIVE_SCAN = new Set(["queued", "running"]);

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SCHEDULE_LABELS: Record<string, string> = {
  none: "None",
  daily: "Dagelijks",
  weekly: "Wekelijks",
};

function scoreColor(score: number): string {
  if (score >= 80) return "is-good";
  if (score >= 50) return "is-watch";
  return "is-risk";
}

function scanStatus(status: string | null): { label: string; tone: string } {
  if (status === "queued" || status === "running") {
    return { label: "Scanning", tone: "is-info" };
  }
  if (status === "completed") return { label: "Complete", tone: "is-success" };
  if (status === "failed") return { label: "Failed", tone: "is-danger" };
  return { label: "Not scanned", tone: "is-neutral" };
}

export function SitesManager({
  sites: initialSites,
  githubEnabled,
  schedulingEnabled,
  activeTestsEnabled,
  isOwner,
}: Props) {
  const [sites, setSites] = useState(initialSites);
  const [url, setUrl] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [label, setLabel] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repoHint, setRepoHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<SiteWithStatus | null>(null);
  const [upsell, setUpsell] = useState<Upsell>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editRepo, setEditRepo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTests, setActiveTests] = useState(false);
  const [authPanelSiteId, setAuthPanelSiteId] = useState<string | null>(null);

  function runValidation(): FormErrors {
    const parsed = addSiteInputSchema.safeParse({
      url,
      github_repo: githubRepo,
      label: label || undefined,
    });
    const errors: FormErrors = {};
    for (const issue of parsed.error?.issues ?? []) {
      const key = issue.path[0] as keyof FormErrors;
      if (key !== undefined && !errors[key]) errors[key] = issue.message;
    }
    return errors;
  }

  function onChangeUrl(value: string) {
    setUrl(value);
    const detected = detectGithubRepoFromUrl(value);
    if (detected) {
      setGithubRepo(detected);
      setRepoHint(
        `GitHub repo detected as ${detected} — also enter a website URL`,
      );
    } else {
      setRepoHint(null);
    }
    const errors = runValidation();
    if (showErrors) setFieldErrors(errors);
    else setFieldErrors((prev) => ({ ...prev, url: undefined }));
  }

  function onChangeGithub(value: string) {
    setGithubRepo(value);
    setRepoHint(null);
    const errors = runValidation();
    if (showErrors) setFieldErrors(errors);
    else setFieldErrors((prev) => ({ ...prev, github_repo: undefined }));
  }

  function onChangeLabel(value: string) {
    setLabel(value);
    const errors = runValidation();
    if (showErrors) setFieldErrors(errors);
    else setFieldErrors((prev) => ({ ...prev, label: undefined }));
  }

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sites");
    if (!res.ok) return;
    const data = await res.json();
    if (data?.sites) setSites(data.sites);
  }, []);

  const hasActiveScan = sites.some(
    (s) => s.last_scan_status !== null && ACTIVE_SCAN.has(s.last_scan_status),
  );

  useEffect(() => {
    if (!hasActiveScan) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [hasActiveScan, refresh]);

  async function scanSite(site: SiteWithStatus) {
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      // Plan 77: blokkeer de scan met een eigendom-hint wanneer activeTests
      // aan staat maar domeineigendom niet geverifieerd is of er geen
      // wegwerp-testaccount is. De server-kant gatet ook (skip + info-finding),
      // maar deze hint voorkomt een nutteloze scan.
      if (activeTests) {
        const [ownRes, credRes] = await Promise.all([
          fetch(`/api/sites/${site.id}/ownership`),
          fetch(`/api/sites/${site.id}/auth-credentials`),
        ]);
        const own = ownRes.ok ? await ownRes.json().catch(() => null) : null;
        const cred = credRes.ok ? await credRes.json().catch(() => null) : null;
        const ownershipOk =
          own && ownershipVerificationStatus(own.verified_at) === "verified";
        const hasCreds = Boolean(cred?.has_credentials);
        if (!ownershipOk || !hasCreds) {
          setAuthPanelSiteId(site.id);
          setFormError(
            !ownershipOk
              ? "Verifieer eerst domeineigendom voordat je de auth-flow-scanner draait."
              : "Voeg een wegwerp-testaccount toe voordat je de auth-flow-scanner draait.",
          );
          return;
        }
      }

      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: site.id,
          active_tests: activeTests,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        return;
      }
      if (res.status === 402) {
        setUpsell({ plan: "pro", error: data?.error ?? "Scan-limiet bereikt" });
        return;
      }
      if (!res.ok) {
        setFormError(data?.error ?? "Failed to start scan");
        return;
      }
      setDuplicate(null);
      setNotice("Scan gestart");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function changeSchedule(site: SiteWithStatus, frequency: string) {
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        return;
      }
      if (!res.ok) {
        setFormError(data?.error ?? "Schema wijzigen mislukt");
        return;
      }
      setNotice(
        frequency === "none"
          ? "Scheduled scans turned off"
          : `Scheduled scans set (${SCHEDULE_LABELS[frequency]})`,
      );
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    setDuplicate(null);
    const errors = runValidation();
    setShowErrors(true);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          github_repo: githubRepo || undefined,
          label: label || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        setFormError(data.error);
        return;
      }
      if (res.status === 409) {
        if (data?.site) setDuplicate(data.site);
        setFormError(data?.error ?? "This site is already on your list");
        return;
      }
      if (!res.ok) {
        throw new Error(data?.error ?? "Opslaan mislukt");
      }
      setUrl("");
      setGithubRepo("");
      setLabel("");
      setShowErrors(false);
      setFieldErrors({});
      setNotice(`"${hostOf(data.site.url)}" added`);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(site: SiteWithStatus) {
    setEditingId(site.id);
    setEditLabel(site.label ?? "");
    setEditRepo(site.github_repo ?? "");
    setFormError(null);
    setNotice(null);
  }

  async function saveEdit(site: SiteWithStatus) {
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel || null,
          github_repo: editRepo || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.upsell) {
        setUpsell(data);
        setFormError(data.error);
        return;
      }
      if (!res.ok) {
        setFormError(data?.error ?? "Wijzigen mislukt");
        return;
      }
      setEditingId(null);
      setNotice("Site updated");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeSite(site: SiteWithStatus) {
    const name = site.label ?? hostOf(site.url);
    if (!window.confirm(`Remove "${name}" and all scans for this site??`)) return;
    setBusyId(site.id);
    setFormError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFormError(data?.error ?? "Removeen mislukt");
        return;
      }
      setSites((prev) => prev.filter((s) => s.id !== site.id));
      setNotice("Site removed");
    } finally {
      setBusyId(null);
    }
  }

  async function upgrade() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: upsell?.plan ?? "pro" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Checkout starten mislukt");
      window.location.assign(data.url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Checkout starten mislukt");
      setUpgrading(false);
    }
  }

  const runningCount = sites.filter((site) => ACTIVE_SCAN.has(site.last_scan_status ?? "")).length;
  const onlineCount = sites.filter((site) => site.uptime_state === "up").length;

  return (
    <div className="sites-manager">
      {(formError || notice) && (
        <div className={`workspace-alert ${formError ? "is-error" : "is-success"}`} role={formError ? "alert" : "status"}>
          {formError ? <WarningCircle size={18} aria-hidden="true" /> : <CheckCircle size={18} aria-hidden="true" />}
          <span>{formError ?? notice}</span>
        </div>
      )}

      {duplicate && (
        <div className="workspace-alert is-warning" role="status">
          <WarningCircle size={18} aria-hidden="true" />
          <span><strong>{hostOf(duplicate.url)}</strong> is already in this workspace.</span>
          <button type="button" onClick={() => scanSite(duplicate)} disabled={busyId === duplicate.id}>
            {busyId === duplicate.id ? "Starting…" : "Scan anyway"}
          </button>
        </div>
      )}

      <div className="sites-setup-grid">
        <form onSubmit={submit} className="site-add-panel">
          <div className="site-add-heading">
            <span><Plus size={19} aria-hidden="true" /></span>
            <div>
              <h2>Add a property</h2>
              <p>Connect a public website. Add its repository when your plan supports source checks.</p>
            </div>
          </div>

          <div className="site-form-grid">
            <label className="site-field is-wide">
              <span>Website URL</span>
              <input type="text" required value={url} onChange={(event) => onChangeUrl(event.target.value)} placeholder="example.com" />
              {showErrors && fieldErrors.url && <small className="is-error">{fieldErrors.url}</small>}
              {repoHint && <small className="is-warning">{repoHint}</small>}
            </label>
            <label className="site-field">
              <span>Workspace label <small>Optional</small></span>
              <input type="text" value={label} onChange={(event) => onChangeLabel(event.target.value)} placeholder="Production store" />
              {showErrors && fieldErrors.label && <small className="is-error">{fieldErrors.label}</small>}
            </label>
            <label className="site-field">
              <span>GitHub repository {!githubEnabled && <small className="site-pro-badge">Pro</small>}</span>
              <input type="text" value={githubRepo} onChange={(event) => onChangeGithub(event.target.value)} disabled={!githubEnabled} placeholder="owner/repo" />
              {showErrors && fieldErrors.github_repo && <small className="is-error">{fieldErrors.github_repo}</small>}
            </label>
          </div>

          <div className="site-add-footer">
            <p><ShieldCheck size={16} aria-hidden="true" /> The first scan can be started after the property is saved.</p>
            <button type="submit" disabled={submitting} className="dashboard-primary-button">
              <Plus size={17} aria-hidden="true" /> {submitting ? "Adding…" : "Add property"}
            </button>
          </div>
        </form>

        <aside className="sites-pulse-panel" aria-label="Workspace site summary">
          <div className="sites-pulse-heading">
            <span><Pulse size={19} aria-hidden="true" /></span>
            <h2>Workspace pulse</h2>
          </div>
          <dl>
            <div><dt>Properties</dt><dd>{sites.length}</dd></div>
            <div><dt>Online now</dt><dd>{onlineCount}</dd></div>
            <div><dt>Scanning</dt><dd>{runningCount}</dd></div>
          </dl>
          <p>Availability and scan status update automatically while this page is open.</p>
        </aside>
      </div>

      <section className="sites-inventory">
        <div className="sites-inventory-heading">
          <div>
            <h2>Properties</h2>
            <p>Security posture, scan cadence, and availability at a glance.</p>
          </div>
          <label className="active-tests-control">
            <input
              type="checkbox"
              checked={activeTests}
              disabled={!activeTestsEnabled}
              onChange={(event) => {
                if (!activeTestsEnabled) {
                  setUpsell({ plan: "pro", error: "Active vulnerability tests are available on Pro." });
                  return;
                }
                setActiveTests(event.target.checked);
              }}
            />
            <span>Active tests</span>
            {!activeTestsEnabled && <small>Pro</small>}
          </label>
        </div>

        {sites.length === 0 ? (
          <div className="sites-empty-state">
            <span><GlobeHemisphereWest size={24} aria-hidden="true" /></span>
            <div><strong>No properties yet</strong><p>Add your first website above, then start a scan when you are ready.</p></div>
          </div>
        ) : (
          <div className="site-card-list">
            {sites.map((site) => {
              const status = scanStatus(site.last_scan_status);
              return (
                <article key={site.id} className="site-operation-card">
                  <div className="site-identity">
                    <span className="site-icon"><GlobeHemisphereWest size={21} aria-hidden="true" /></span>
                    {editingId === site.id ? (
                      <div className="site-edit-fields">
                        <input type="text" value={editLabel} onChange={(event) => setEditLabel(event.target.value)} placeholder="Label" aria-label={`Label for ${site.url}`} />
                        <input type="text" value={editRepo} onChange={(event) => setEditRepo(event.target.value)} placeholder="owner/repo" aria-label={`GitHub repository for ${site.url}`} />
                        <div>
                          <button type="button" onClick={() => saveEdit(site)} disabled={busyId === site.id}>Save</button>
                          <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Link href={`/sites/${site.id}`}>{site.label ?? hostOf(site.url)}</Link>
                        <span>{site.url}</span>
                        {site.github_repo && (
                          <a href={`https://github.com/${site.github_repo}`} target="_blank" rel="noreferrer" className="site-repository">
                            <GithubLogo size={13} aria-hidden="true" /> {site.github_repo} <ArrowSquareOut size={11} aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="site-signal-group">
                    <div className="site-signal">
                      <span>Latest scan</span>
                      <strong className={`site-status ${status.tone}`}>{status.label}</strong>
                      <small>{formatDate(site.last_scanned_at)}</small>
                    </div>
                    <div className="site-signal">
                      <span>Security score</span>
                      {site.last_scan_score !== null ? (
                        <strong className={`site-score ${scoreColor(site.last_scan_score)}`}>{site.last_scan_score}</strong>
                      ) : <strong>—</strong>}
                      {site.last_scan_id && <Link href={`/scans/${site.last_scan_id}`}>View evidence</Link>}
                    </div>
                    <div className="site-signal">
                      <span>Availability</span>
                      {site.uptime_state === "up" ? (
                        <Link href={`/uptime/${site.id}`} className="site-uptime is-up">Online</Link>
                      ) : site.uptime_state === "down" ? (
                        <Link href={`/uptime/${site.id}`} className="site-uptime is-down">Offline</Link>
                      ) : <strong>—</strong>}
                    </div>
                  </div>

                  <div className="site-cadence">
                    <label>
                      <CalendarBlank size={15} aria-hidden="true" />
                      <span>Cadence</span>
                      <select value={site.scan_frequency} onChange={(event) => changeSchedule(site, event.target.value)} disabled={busyId === site.id} aria-label={`Scan cadence for ${site.url}`}>
                        <option value="none">Manual</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </label>
                    <small>{site.scan_frequency !== "none" ? `Next ${formatDateTime(site.next_scan_at)}` : "Run when you choose"}</small>
                    {!schedulingEnabled && <span className="site-pro-badge">Pro scheduling</span>}
                  </div>

                  <div className="site-actions">
                    <button type="button" onClick={() => scanSite(site)} disabled={busyId === site.id} className="site-scan-action">
                      <Play size={15} weight="fill" aria-hidden="true" /> {busyId === site.id ? "Starting…" : "Run scan"}
                    </button>
                    {activeTestsEnabled && (
                      <button type="button" onClick={() => setAuthPanelSiteId(authPanelSiteId === site.id ? null : site.id)} aria-label={`Auth test-account voor ${site.url}`} title="Auth-flow test-account">
                        <Key size={17} aria-hidden="true" />
                      </button>
                    )}
                    <button type="button" onClick={() => editingId === site.id ? setEditingId(null) : startEdit(site)} aria-label={`Edit ${site.label ?? site.url}`}>
                      {editingId === site.id ? <X size={17} aria-hidden="true" /> : <PencilSimple size={17} aria-hidden="true" />}
                    </button>
                    {isOwner && (
                      <button type="button" onClick={() => removeSite(site)} disabled={busyId === site.id} className="is-danger" aria-label={`Delete ${site.label ?? site.url}`}>
                        <Trash size={17} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {activeTestsEnabled && (
                    <SiteAuthAccount
                      siteId={site.id}
                      siteUrl={site.url}
                      open={authPanelSiteId === site.id}
                      onClose={() => setAuthPanelSiteId(null)}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {upsell && (
        <div className="workspace-modal-backdrop" role="presentation">
          <div className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
            <span className="workspace-modal-icon"><ShieldCheck size={23} aria-hidden="true" /></span>
            <h2 id="upgrade-title">This feature requires Pro</h2>
            <p>{upsell.error}</p>
            <div>
              <button type="button" onClick={upgrade} disabled={upgrading} className="dashboard-primary-button">{upgrading ? "Opening checkout…" : "Upgrade to Pro"}</button>
              <button type="button" onClick={() => setUpsell(null)} disabled={upgrading} className="dashboard-light-button">Maybe later</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
