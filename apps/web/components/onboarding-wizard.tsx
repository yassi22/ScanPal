"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type UpsellState = {
  plan: string;
  error: string;
  usage?: { creditsUsed: number; creditsLimit: number };
} | null;

export function OnboardingWizard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<UpsellState>(null);
  const [upgrading, setUpgrading] = useState(false);

  async function startScan(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setUpsell(null);
    try {
      const res = await fetch("/api/onboarding/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 402 && data?.upsell) {
        setUpsell(data);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "Er ging iets mis");
      router.push(`/scans/${data.scan.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setSubmitting(false);
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

  return (
    <div>
      <form
        onSubmit={startScan}
        className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8"
      >
        <h1 className="text-2xl font-bold">Scan je eerste website</h1>
        <p className="mt-2 text-sm text-slate-400">
          Voer de URL van een website in. ScanPal voert direct een eerste set
          checks uit — straks worden dat er 100+.
        </p>

        {formError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {formError}
          </div>
        )}

        <label className="mt-6 block">
          <span className="text-sm font-medium text-slate-300">Website URL</span>
          <input
            type="text"
            required
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="voorbeeld.nl"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition focus:border-brand"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-brand px-4 py-3 font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
        >
          {submitting ? "Starten…" : "Start scan"}
        </button>
      </form>

      {upsell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8">
            <h2 className="text-xl font-bold">Scan-limiet bereikt</h2>
            <p className="mt-2 text-sm text-slate-400">{upsell.error}</p>
            {upsell.usage && (
              <p className="mt-3 text-sm text-slate-300">
                Verbruikt: {upsell.usage.creditsUsed} van de{" "}
                {upsell.usage.creditsLimit} scans.
              </p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={upgrade}
                disabled={upgrading}
                className="flex-1 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
              >
                {upgrading ? "Bezig…" : "Upgrade naar Pro"}
              </button>
              <button
                type="button"
                onClick={() => setUpsell(null)}
                disabled={upgrading}
                className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold transition hover:border-slate-500 disabled:opacity-50"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
