"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { NotificationType, NotificationView } from "@scanpal/shared";

const TYPE_LABELS: Record<NotificationType, string> = {
  scan_done: "Scan voltooid",
  score_drop: "Score gedaald",
  site_down: "Site down",
  site_recovered: "Site hersteld",
  critical_finding: "Kritieke bevinding",
  credit_skip: "Scan overgeslagen",
  scan_failed: "Scan mislukt",
  webhook_disabled: "Webhook uitgeschakeld",
  payment_failed: "Betalingsfout",
  domain_alert: "Domein-alert",
};

const TYPE_COLORS: Record<NotificationType, string> = {
  scan_done: "bg-teal-500/15 text-teal-400",
  score_drop: "bg-amber-500/15 text-amber-400",
  site_down: "bg-red-500/15 text-red-400",
  site_recovered: "bg-emerald-500/15 text-emerald-400",
  critical_finding: "bg-red-500/15 text-red-400",
  credit_skip: "bg-slate-500/15 text-slate-400",
  scan_failed: "bg-orange-500/15 text-orange-400",
  webhook_disabled: "bg-purple-500/15 text-purple-400",
  payment_failed: "bg-red-500/15 text-red-400",
  domain_alert: "bg-amber-500/15 text-amber-400",
};

const PAGE_SIZE = 20;

type Props = {
  initial: NotificationView[];
  initialUnread: number;
  initialTotal: number;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationsList({ initial, initialUnread, initialTotal }: Props) {
  const [items, setItems] = useState<NotificationView[]>(initial);
  const [unread, setUnread] = useState(initialUnread);
  const [total, setTotal] = useState(initialTotal);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (nextFilter: "all" | "unread", offset: number) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (nextFilter === "unread") params.set("unread", "true");
      const res = await fetch(`/api/notifications?${params}`);
      if (!res.ok) throw new Error("Meldingen laden mislukt");
      return (await res.json()) as {
        notifications: NotificationView[];
        unread: number;
        total: number;
      };
    },
    [],
  );

  async function switchFilter(nextFilter: "all" | "unread") {
    setFilter(nextFilter);
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPage(nextFilter, 0);
      setItems(data.notifications);
      setUnread(data.unread);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPage(filter, items.length);
      setItems((prev) => [...prev, ...data.notifications]);
      setUnread(data.unread);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function markRead(notification: NotificationView) {
    if (notification.read_at) return;
    setBusyId(notification.id);
    setError(null);
    try {
      const res = await fetch(`/api/notifications/${notification.id}/read`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Markeren als gelezen mislukt");
      const data = await res.json();
      setItems((prev) =>
        prev.map((n) => (n.id === notification.id ? data.notification : n)),
      );
      setUnread((u) => Math.max(0, u - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setError(null);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error("Alles gelezen markeren mislukt");
      setItems((prev) =>
        prev.map((n) =>
          n.read_at ? n : { ...n, read_at: new Date().toISOString() },
        ),
      );
      setUnread(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    }
  }

  return (
    <div className="mt-8">
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex gap-2 text-sm">
          {(["all", "unread"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => switchFilter(option)}
              disabled={loading}
              className={`rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                filter === option
                  ? "bg-brand font-semibold text-slate-950"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {option === "all" ? "Alle" : `Ongelezen (${unread})`}
            </button>
          ))}
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="text-sm text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline"
          >
            Alles als gelezen markeren
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
          <p className="font-medium">Geen meldingen</p>
          <p className="mt-1 text-sm text-slate-400">
            {filter === "unread"
              ? "Je hebt geen ongelezen meldingen."
              : "Nieuwe meldingen over scans, uptime en bevindingen verschijnen hier."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-2xl border px-4 py-3 transition ${
                notification.read_at
                  ? "border-slate-800 bg-slate-950/40"
                  : "border-slate-700 bg-slate-900/60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <Link
                  href={notification.link}
                  className="min-w-0"
                  onClick={() => void markRead(notification)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[notification.type]}`}
                    >
                      {TYPE_LABELS[notification.type]}
                    </span>
                    {!notification.read_at && (
                      <span className="h-2 w-2 rounded-full bg-brand" />
                    )}
                    <span className="text-xs text-slate-500">
                      {formatTime(notification.created_at)}
                    </span>
                  </div>
                  <p
                    className={`mt-1.5 text-sm ${
                      notification.read_at
                        ? "text-slate-400"
                        : "font-medium text-slate-200"
                    }`}
                  >
                    {notification.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">
                    {notification.body}
                  </p>
                </Link>
                {!notification.read_at && (
                  <button
                    type="button"
                    disabled={busyId === notification.id}
                    onClick={() => void markRead(notification)}
                    className="shrink-0 text-xs text-slate-500 underline-offset-2 transition hover:text-slate-200 hover:underline disabled:opacity-50"
                  >
                    Markeer gelezen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length < total && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          >
            {loading ? "Laden…" : "Meer laden"}
          </button>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-600">
        Meldingen ouder dan 90 dagen worden automatisch opgeruimd. Je
        voorkeuren beheer je op{" "}
        <Link
          href="/settings/notifications"
          className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
        >
          Notificatievoorkeuren
        </Link>
        .
      </p>
    </div>
  );
}
