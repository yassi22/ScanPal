"use client";

import { useState } from "react";
import type {
  NotificationType,
  WebhookDeliveryView,
  WebhookView,
} from "@scanpal/shared";
import { notificationTypes } from "@scanpal/shared";

const EVENT_LABELS: Record<NotificationType, string> = {
  scan_done: "Scan voltooid",
  score_drop: "Score gedaald",
  scan_diff: "Wijzigingen gedetecteerd",
  site_down: "Site down",
  site_recovered: "Site hersteld",
  critical_finding: "Kritieke bevinding",
  credit_skip: "Scan overgeslagen",
  scan_failed: "Scan mislukt",
  webhook_disabled: "Webhook uitgeschakeld",
  payment_failed: "Betalingsfout",
  domain_alert: "Domein-alert",
};

const DELIVERY_LABELS: Record<string, string> = {
  pending: "Wachtend",
  ok: "Bezorgd",
  failed: "Mislukt",
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
      if (!res.ok) throw new Error(data?.error ?? "Aanmaken mislukt");
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
      setBanner(data?.error ?? "Opslaan mislukt");
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
      setBanner(data?.error ?? "Verwijderen mislukt");
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
      setBanner(data?.error ?? "Test-delivery mislukt");
      return;
    }
    const status = data.delivery?.status;
    setNotice(
      status === "ok"
        ? `Test-delivery bezorgd (HTTP ${data.delivery.http_status})`
        : `Test-delivery ${DELIVERY_LABELS[status] ?? status ?? "mislukt"}`,
    );
  }

  async function rotateSecret(webhookId: string) {
    if (!window.confirm("Secret roteren? Het oude secret wordt direct ongeldig.")) return;
    setBanner(null);
    setRotatedSecret(null);
    const res = await fetch(`/api/webhooks/${webhookId}/secret`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBanner(data?.error ?? "Roteren mislukt");
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
      setBanner(data?.error ?? "Log ophalen mislukt");
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
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        error
          ? "border-red-500/30 bg-red-500/10 text-red-400"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      }`}
    >
      {error ?? notice}
    </div>
  );

  return (
    <div className="mt-8 space-y-8">
      {banner}

      {(createdSecret || rotatedSecret) && (
        <div className="rounded-2xl border border-brand/40 bg-brand/10 p-6">
          <h2 className="font-semibold text-slate-100">
            {createdSecret ? "Webhook aangemaakt" : "Secret geroteerd"} — bewaar hem nu
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Het signing-secret wordt maar één keer getoond. Gebruik het om de{" "}
            <code className="text-slate-300">x-scanpal-signature</code>-header te
            verifiëren (HMAC-SHA256 over de raw body).
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-emerald-300">
              {(createdSecret ?? rotatedSecret) as string}
            </code>
            <button
              onClick={() => copySecret((createdSecret ?? rotatedSecret) as string)}
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
            >
              Kopiëren
            </button>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Nieuwe webhook</h2>
        <p className="mt-1 text-sm text-slate-400">
          Kies bij welke events ScanPal een POST naar je endpoint stuurt. Payload:
          envelop v1 met de notificatie-data, gesigneerd met HMAC-SHA256.
        </p>
        <form onSubmit={createWebhook} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bijv. CI-pipeline"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            />
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.voorbeeld.nl/scanpal-webhook"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {notificationTypes.map((type) => (
              <label
                key={type}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                  events.includes(type)
                    ? "border-brand/50 bg-brand/10 text-slate-200"
                    : "border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={events.includes(type)}
                  onChange={() => toggleEvent(type)}
                  className="accent-brand"
                />
                {EVENT_LABELS[type]}
              </label>
            ))}
          </div>
          <div>
            <button
              type="submit"
              disabled={loading || events.length === 0}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
            >
              {loading ? "Aanmaken…" : "Webhook aanmaken"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Webhooks ({webhooks.length})</h2>
        {webhooks.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            Nog geen webhooks. Maak er één aan om notificatie-events naar je
            eigen infrastructuur te sturen.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {webhooks.map((webhook) => (
              <li
                key={webhook.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-slate-200">
                      {webhook.name}
                      {webhook.active ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                          actief
                        </span>
                      ) : (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                          uitgeschakeld
                        </span>
                      )}
                      {webhook.failure_count > 0 && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                          {webhook.failure_count} mislukt
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      <code className="text-slate-400">{webhook.url}</code>
                      {webhook.last_delivery_at
                        ? ` · laatste bezorging ${new Date(webhook.last_delivery_at).toLocaleString("nl-NL")}`
                        : " · nog geen bezorging"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {webhook.events.map((event) => (
                        <span
                          key={event}
                          className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400"
                        >
                          {EVENT_LABELS[event as NotificationType]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() => toggleWebhook(webhook)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                    >
                      {webhook.active ? "Uitschakelen" : "Inschakelen"}
                    </button>
                    <button
                      onClick={() => testWebhook(webhook.id)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => openLog(webhook.id)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                    >
                      {logFor === webhook.id ? "Log sluiten" : "Log"}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => rotateSecret(webhook.id)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                      >
                        Secret roteren
                      </button>
                    )}
                    <button
                      onClick={() => deleteWebhook(webhook)}
                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-red-400 transition hover:border-red-500/60 hover:text-red-300"
                    >
                      Verwijderen
                    </button>
                  </div>
                </div>

                {logFor === webhook.id && (
                  <div className="mt-4 border-t border-slate-800 pt-3">
                    <h3 className="text-sm font-medium text-slate-300">
                      Delivery-log ({log?.total ?? 0})
                    </h3>
                    {!log || log.deliveries.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Nog geen deliveries.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {log.deliveries.map((delivery) => (
                          <li
                            key={delivery.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"
                          >
                            <span>
                              <span className="text-slate-300">
                                {EVENT_LABELS[delivery.event as NotificationType] ??
                                  delivery.event}
                              </span>{" "}
                              · {new Date(delivery.created_at).toLocaleString("nl-NL")}
                              {delivery.http_status
                                ? ` · HTTP ${delivery.http_status}`
                                : ""}
                            </span>
                            <span className="flex items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 ${
                                  delivery.status === "ok"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : delivery.status === "rejected"
                                      ? "bg-slate-500/10 text-slate-400"
                                      : delivery.status === "failed"
                                        ? "bg-amber-500/10 text-amber-400"
                                        : delivery.status === "disabled"
                                          ? "bg-red-500/10 text-red-400"
                                          : "bg-slate-500/10 text-slate-300"
                                }`}
                              >
                                {DELIVERY_LABELS[delivery.status] ?? delivery.status}
                              </span>
                              {delivery.attempts > 0 && ` · poging ${delivery.attempts}`}
                              {delivery.next_attempt_at && (
                                <span className="text-slate-500">
                                  · volgende {new Date(delivery.next_attempt_at).toLocaleString("nl-NL")}
                                </span>
                              )}
                              {delivery.error && (
                                <code className="max-w-60 truncate text-slate-500">
                                  {delivery.error}
                                </code>
                              )}
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
        <p className="mt-4 text-xs text-slate-500">
          Bezorging is HMAC-SHA256-gesigneerd ({`sha256=…`} in{" "}
          <code className="text-slate-400">x-scanpal-signature</code>) met
          retry/backoff; na 5 mislukte pogingen wordt de webhook automatisch
          uitgeschakeld. Endpoints op loopback/private netwerken worden
          geweigerd.
        </p>
      </section>
    </div>
  );
}
