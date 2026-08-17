"use client";

import { useState } from "react";
import Link from "next/link";

type Props = {
  siteId: string;
  githubRepo: string | null;
  configured: boolean;
  onDeployEnabled: boolean;
};

/**
 * Plan 58 — on-deploy triggers op de site-detailpagina. Zet de GitHub-
 * webhook op (secret 1× zichtbaar, owner-only route) en toont de
 * Vercel-instructies (env-secret, geen per-site setup). Alleen Pro.
 */
export function DeployWebhookCard({
  siteId,
  githubRepo,
  configured,
  onDeployEnabled,
}: Props) {
  const [secret, setSecret] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = url ?? `${origin}/api/webhooks/github`;

  async function setup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/deploy-webhook`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Instellen mislukt");
        return;
      }
      setUrl(data?.url ?? null);
      setSecret(data?.secret ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, field: "url" | "secret") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard kan geblokkeerd zijn — de waarde staat zichtbaar in de UI.
    }
  }

  if (!onDeployEnabled) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">On-deploy triggers</h2>
            <p className="mt-1 text-sm text-slate-400">
              Scan automatisch bij elke deployment (GitHub push of
              deployment-status, Vercel deploy). Alleen beschikbaar op Pro.
            </p>
          </div>
          <Link
            href="/billing"
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Upgrade naar Pro
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <h2 className="text-lg font-semibold">On-deploy triggers</h2>
      <p className="mt-1 text-sm text-slate-400">
        Scan automatisch bij elke deployment. Koppel een GitHub-repo voor push
        + deployment-status, of koppel Vercel voor deployment.completed.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-300">GitHub</h3>
          {!githubRepo ? (
            <p className="mt-1 text-xs text-slate-500">
              Koppel eerst een GitHub-repo (site-instellingen) om de webhook te
              gebruiken.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-400">
                Voeg een webhook toe in GitHub (Settings → Webhooks) met deze
                URL. Events: <span className="font-mono">push</span> en{" "}
                <span className="font-mono">deployment_status</span>. Push telt
                alleen op de default branch.
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                <code className="flex-1 truncate text-xs text-slate-300">
                  {webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(webhookUrl, "url")}
                  className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 transition hover:border-slate-500"
                >
                  {copied === "url" ? "Gekopieerd" : "Kopiëren"}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void setup()}
                  disabled={busy}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
                >
                  {busy
                    ? "Bezig…"
                    : configured
                      ? "Secret roteren"
                      : "Secret genereren"}
                </button>
                {secret && (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs text-amber-300">
                      {secret}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copy(secret, "secret")}
                      className="shrink-0 rounded-md border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-300 transition hover:border-amber-400"
                    >
                      {copied === "secret" ? "Gekopieerd" : "Kopiëren"}
                    </button>
                  </div>
                )}
              </div>
              {secret && (
                <p className="mt-2 text-xs text-amber-400">
                  Dit secret wordt maar één keer getoond — vul het direct in als
                  GitHub-secret.
                </p>
              )}
              {configured && !secret && (
                <p className="mt-2 text-xs text-emerald-400">
                  Webhook geconfigureerd. Een nieuwe webhook in GitHub vervangt
                  het secret.
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-slate-800 pt-4">
          <h3 className="text-sm font-semibold text-slate-300">Vercel</h3>
          <p className="mt-1 text-xs text-slate-400">
            Maak in Vercel (Project → Settings → Webhooks) een webhook op{" "}
            <code className="font-mono">{webhookUrl}</code> voor{" "}
            <span className="font-mono">deployment.completed</span>, met als
            secret de <span className="font-mono">VERCEL_WEBHOOK_SECRET</span>{" "}
            env-variabele. De payload-URL matcht de site op hostname.
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}