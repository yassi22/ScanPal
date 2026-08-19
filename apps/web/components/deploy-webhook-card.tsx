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
        setError(data?.error ?? "Unable to configure the deploy webhook. Try again.");
        return;
      }
      setUrl(data?.url ?? null);
      setSecret(data?.secret ?? null);
    } catch {
      setError("The webhook service could not be reached. Check your connection and try again.");
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
      <section className="site-detail-section deploy-webhook-card">
        <div className="site-detail-action-heading">
          <div>
            <h2>On-deploy scans</h2>
            <p>
              Start a scan after a GitHub push, deployment status or Vercel
              deployment. Available on Pro.
            </p>
          </div>
          <Link
            href="/billing"
            className="site-detail-primary-action"
          >
            Upgrade to Pro
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="site-detail-section deploy-webhook-card">
      <h2>On-deploy scans</h2>
      <p className="site-detail-section-copy">
        Start a scan automatically after a deployment. Connect GitHub for push
        and deployment status events, or Vercel for deployment.completed.
      </p>

      <div className="deploy-provider-list">
        <div className="deploy-provider">
          <h3>GitHub</h3>
          {!githubRepo ? (
            <p>
              Connect a GitHub repository in the site settings before enabling
              this webhook.
            </p>
          ) : (
            <>
              <p>
                Add a webhook in GitHub under Settings → Webhooks. Subscribe to{" "}
                <code>push</code> and <code>deployment_status</code>. Push events
                only count on the default branch.
              </p>
              <div className="site-detail-code-row">
                <code>{webhookUrl}</code>
                <button
                  type="button"
                  onClick={() => void copy(webhookUrl, "url")}
                  className="site-detail-code-action"
                >
                  {copied === "url" ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="deploy-secret-actions">
                <button
                  type="button"
                  onClick={() => void setup()}
                  disabled={busy}
                  className="site-detail-secondary-action"
                >
                  {busy
                    ? "Working…"
                    : configured
                      ? "Rotate secret"
                      : "Generate secret"}
                </button>
                {secret && (
                  <div className="deploy-secret-value">
                    <code>{secret}</code>
                    <button
                      type="button"
                      onClick={() => void copy(secret, "secret")}
                      className="site-detail-code-action"
                    >
                      {copied === "secret" ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
              {secret && (
                <p className="site-detail-message is-warning">
                  This secret is shown once. Add it to GitHub immediately.
                </p>
              )}
              {configured && !secret && (
                <p className="site-detail-message is-success">
                  Webhook configured. Rotating it replaces the GitHub secret.
                </p>
              )}
            </>
          )}
        </div>

        <div className="deploy-provider">
          <h3>Vercel</h3>
          <p>
            In Project → Settings → Webhooks, send{" "}
            <code>deployment.completed</code> to <code>{webhookUrl}</code> and use{" "}
            <code>VERCEL_WEBHOOK_SECRET</code> as the secret. The payload URL
            matches this site by hostname.
          </p>
        </div>
      </div>

      {error && <p className="site-detail-message is-error" role="alert">{error}</p>}
    </section>
  );
}
