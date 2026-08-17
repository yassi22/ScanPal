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
        setError(data?.error ?? "Wijzigen mislukt");
        return;
      }
      setEnabled(next);
      setSlug(data?.site?.public_status_slug ?? null);
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Publieke statuspagina</h2>
          <p className="mt-1 text-sm text-slate-400">
            Deel een statuspagina zonder login met je klanten: live status,
            uptime-percentage en 30/90-dagen-geschiedenis. Alleen uptime-data —
            nooit scores of findings.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void toggle(!enabled)}
          disabled={busy}
          className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
            enabled
              ? "border border-slate-700 text-slate-300 hover:border-slate-500"
              : "bg-brand text-slate-950 hover:bg-brand/90"
          }`}
        >
          {busy ? "Bezig…" : enabled ? "Uitschakelen" : "Publiek maken"}
        </button>
      </div>

      {enabled && shareUrl && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
          <code className="flex-1 truncate text-xs text-slate-300">
            {shareUrl}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 transition hover:border-slate-500"
          >
            {copied ? "Gekopieerd" : "Kopiëren"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}