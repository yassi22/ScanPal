"use client";

import { useState } from "react";
import type {
  NotificationType,
  WebhookDeliveryView,
  WebhookView,
} from "@scanpal/shared";
import { notificationTypes } from "@scanpal/shared";

const EVENT_LABELS: Record<NotificationType, string> = {
  scan_done: "Scan completed",
  score_drop: "Score dropped",
  scan_diff: "Changes detected",
  site_down: "Site down",
  site_recovered: "Site recovered",
  critical_finding: "Critical finding",
  credit_skip: "Scan skipped",
  scan_failed: "Scan failed",
  webhook_disabled: "Webhook disabled",
  payment_failed: "Payment failed",
  domain_alert: "Domain alert",
};

const DELIVERY_LABELS: Record<string, string> = {
  pending: "Wachtend",
  ok: "Bezorgd",
  failed: "Failed",
  rejected: "Geweigerd",
  disabled: "Uitgeschakeld",
};

type Props = {
  isOwner: boolean;
  initialWebhooks: WebhookView[];
};

export function WebhooksSettings({ isOwner, initialWebhooks }: Props) {
  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<NotificationType[]>(["scan_done"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [log, setLog] = useState<{ deliveries: WebhookDeliveryView[]; total: number } | null>(null);

  const setBanner = (err: string | null, ok: string | null = null) => {
    setError(err);
    setNotice(ok);
  };

  function toggleEvent(type: NotificationType) {
    setEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setBanner(null);
    setCreatedSecret(null);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, events }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create");
      setWebhooks((prev) => [data.webhook, ...prev]);
      setCreatedSecret(data.secret);
      setName("");
      setUrl("");
      setEvents(["scan_done"]);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function patchWebhook(webhookId: string, patch: Record<string, unknown>) {
    setBanner(null);
    const res = await fetch(`/api/webhooks/${webhookId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setBanner(data?.error ?? "Failed to save");
      return;
    }
    const updated = await res.json();
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? updated : w)));
  }

  async function toggleWebhook(webhook: WebhookView) {
    await patchWebhook(webhook.id, { active: !webhook.active });
  }

  async function deleteWebhook(webhook: WebhookView) {
    if (!window.confirm(`Webhook "${webhook.name}" verwijderen?`)) return;
    setBanner(null);
    const res = await fetch(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setBanner(data?.error ?? "Failed to delete");
      return;
    }
    setWebhooks((prev) => prev.filter((w) => w.id !== webhook.id));
    setNotice("Webhook verwijderd");
  }

  async function testWebhook(webhookId: string) {
    setBanner(null);
    setNotice(null);
    const res = await fetch(`/api/webhooks/${webhookId}/test`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBanner(data?.error ?? "Test delivery failed");
      return;
    }
    const status = data.delivery?.status;
    setNotice(
      status === "ok"
        ? `Test delivery sent (HTTP ${data.delivery.http_status})`
        : `Test-delivery ${DELIVERY_LABELS[status] ?? status ?? "failed"}`,
    );
  }

  async function rotateSecret(webhookId: string) {
    if (!window.confirm("Secret roteren? Het oude secret wordt direct ongeldig.")) return;
    setBanner(null);
    setRotatedSecret(null);
    const res = await fetch(`/api/webhooks/${webhookId}/secret`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBanner(data?.error ?? "Failed to rotate");
      return;
    }
    setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? data.webhook : w)));
    setRotatedSecret(data.secret);
  }

  async function openLog(webhookId: string) {
    setBanner(null);
    if (logFor === webhookId) {
      setLogFor(null);
      setLog(null);
      return;
    }
    const res = await fetch(`/api/webhooks/${webhookId}/deliveries?limit=20`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBanner(data?.error ?? "Failed to fetch log");
      return;
    }
    setLogFor(webhookId);
    setLog(data);
  }

  async function copySecret(secret: string) {
    await navigator.clipboard.writeText(secret);
    setNotice("Secret gekopieerd — bewaar hem goed, hij wordt niet meer getoond.");
  }

  const banner = (error || notice) && (
    <p className={`workspace-alert${error ? " is-error" : ""}`} role="alert">
      {error ?? notice}
    </p>
  );

  return (
    <div className="settings-stack">
      {banner}

      {(createdSecret || rotatedSecret) && (
        <div className="settings-secret-card">
          <h2>
            {createdSecret ? "Webhook aangemaakt" : "Secret geroteerd"} — bewaar hem nu
          </h2>
          <p>
            Het signing-secret wordt maar één keer getoond. Gebruik het om de{" "}
            <code className="settings-code">x-scanpal-signature</code>-header te
            verifiëren (HMAC-SHA256 over de raw body).
          </p>
          <div className="settings-secret-reveal">
            <code className="settings-secret-value">
              {(createdSecret ?? rotatedSecret) as string}
            </code>
            <button
              onClick={() => copySecret((createdSecret ?? rotatedSecret) as string)}
              className="dashboard-primary-button"
            >
              Kopiëren
            </button>
          </div>
        </div>
      )}

      <section className="settings-card">
        <h2>Nieuwe webhook</h2>
        <p className="settings-card-intro">
          Kies bij welke events ScanPal een POST naar je endpoint stuurt. Payload:
          envelop v1 met de notificatie-data, gesigneerd met HMAC-SHA256.
        </p>
        <form onSubmit={createWebhook} className="settings-form">
          <div className="settings-form-row">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bijv. CI-pipeline"
              className="settings-input"
            />
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/scanpal-webhook"
              className="settings-input"
            />
          </div>
          <div className="settings-event-picker">
            {notificationTypes.map((type) => (
              <label
                key={type}
                className={`settings-event-option${events.includes(type) ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={events.includes(type)}
                  onChange={() => toggleEvent(type)}
                />
                {EVENT_LABELS[type]}
              </label>
            ))}
          </div>
          <div>
            <button
              type="submit"
              disabled={loading || events.length === 0}
              className="dashboard-primary-button"
            >
              {loading ? "Aanmaken…" : "Webhook aanmaken"}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-card">
        <h2>Webhooks ({webhooks.length})</h2>
        {webhooks.length === 0 ? (
          <p className="settings-note">
            No webhooks yet. Create one to send notification events to your
            eigen infrastructuur te sturen.
          </p>
        ) : (
          <ul className="settings-item-list">
            {webhooks.map((webhook) => (
              <li key={webhook.id} className="settings-item">
                <div className="settings-item-head">
                  <div className="min-w-0">
                    <p className="settings-item-title">
                      {webhook.name}
                      {webhook.active ? (
                        <span className="settings-chip is-success">actief</span>
                      ) : (
                        <span className="settings-chip is-danger">uitgeschakeld</span>
                      )}
                      {webhook.failure_count > 0 && (
                        <span className="settings-chip is-warning">
                          {webhook.failure_count} failed
                        </span>
                      )}
                    </p>
                    <p className="settings-item-sub">
                      <code>{webhook.url}</code>
                      {webhook.last_delivery_at
                        ? ` · last delivery ${new Date(webhook.last_delivery_at).toLocaleString("en-GB")}`
                        : " · no delivery yet"}
                    </p>
                    <div className="settings-event-tags">
                      {webhook.events.map((event) => (
                        <span key={event} className="settings-event-tag">
                          {EVENT_LABELS[event as NotificationType]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="settings-item-actions">
                    <button
                      onClick={() => toggleWebhook(webhook)}
                      className="settings-mini-button"
                    >
                      {webhook.active ? "Uitschakelen" : "Inschakelen"}
                    </button>
                    <button
                      onClick={() => testWebhook(webhook.id)}
                      className="settings-mini-button"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => openLog(webhook.id)}
                      className="settings-mini-button"
                    >
                      {logFor === webhook.id ? "Log sluiten" : "Log"}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => rotateSecret(webhook.id)}
                        className="settings-mini-button"
                      >
                        Secret roteren
                      </button>
                    )}
                    <button
                      onClick={() => deleteWebhook(webhook)}
                      className="settings-mini-button is-danger"
                    >
                      Verwijderen
                    </button>
                  </div>
                </div>

                {logFor === webhook.id && (
                  <div className="settings-log">
                    <h3>Delivery-log ({log?.total ?? 0})</h3>
                    {!log || log.deliveries.length === 0 ? (
                      <p className="settings-note">Nog geen deliveries.</p>
                    ) : (
                      <ul className="settings-log-list">
                        {log.deliveries.map((delivery) => (
                          <li key={delivery.id} className="settings-log-row">
                            <span>
                              <strong>
                                {EVENT_LABELS[delivery.event as NotificationType] ??
                                  delivery.event}
                              </strong>{" "}
                              · {new Date(delivery.created_at).toLocaleString("en-GB")}
                              {delivery.http_status
                                ? ` · HTTP ${delivery.http_status}`
                                : ""}
                            </span>
                            <span className="settings-log-status">
                              <span
                                className={`settings-chip ${
                                  delivery.status === "ok"
                                    ? "is-success"
                                    : delivery.status === "failed"
                                      ? "is-warning"
                                      : delivery.status === "disabled"
                                        ? "is-danger"
                                        : ""
                                }`}
                              >
                                {DELIVERY_LABELS[delivery.status] ?? delivery.status}
                              </span>
                              {delivery.attempts > 0 && ` · attempt ${delivery.attempts}`}
                              {delivery.next_attempt_at &&
                                ` · next ${new Date(delivery.next_attempt_at).toLocaleString("en-GB")}`}
                              {delivery.error && <code>{delivery.error}</code>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="settings-note">
          Bezorging is HMAC-SHA256-gesigneerd ({`sha256=…`} in{" "}
          <code className="settings-code">x-scanpal-signature</code>) met
          retry/backoff; na 5 failed attempts wordt de webhook automatisch
          uitgeschakeld. Endpoints op loopback/private netwerken worden
          geweigerd.
        </p>
      </section>
    </div>
  );
}
