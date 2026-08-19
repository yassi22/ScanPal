"use client";

import { useState } from "react";

type Props = {
  siteId: string;
  initialSlug: string | null;
};

/**
 * Plan 57 — "Publiek maken"-toggle op de site-detailpagina. Maakt de
 * publieke statuspagina aan/uit via `PATCH /api/sites/[id]` en toont de
 * deelbare URL met copy-knop. De slug wordt alleen hier (en in de site-
 * respons) getoond — nergens in een listing.
 */
export function PublicStatusToggle({ siteId, initialSlug }: Props) {
  const [enabled, setEnabled] = useState(initialSlug !== null);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = slug ? `${origin}/status/${slug}` : null;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_status: { enabled: next } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Unable to update the public status page. Try again.");
        return;
      }
      setEnabled(next);
      setSlug(data?.site?.public_status_slug ?? null);
    } catch {
      setError("The status page could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard kan geblokkeerd zijn — de URL staat toch zichtbaar in de UI.
    }
  }

  return (
    <section className="site-detail-section public-status-card">
      <div className="site-detail-action-heading">
        <div>
          <h2>Public status page</h2>
          <p>
            Share live status, uptime and 30/90-day history without a login.
            Scan scores and findings always stay private.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void toggle(!enabled)}
          disabled={busy}
          className={enabled ? "site-detail-secondary-action" : "site-detail-primary-action"}
        >
          {busy ? "Updating…" : enabled ? "Disable" : "Make public"}
        </button>
      </div>

      {enabled && shareUrl && (
        <div className="site-detail-code-row">
          <code>{shareUrl}</code>
          <button
            type="button"
            onClick={() => void copy()}
            className="site-detail-code-action"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {error && <p className="site-detail-message is-error" role="alert">{error}</p>}
    </section>
  );
}
