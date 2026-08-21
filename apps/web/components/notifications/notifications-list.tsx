"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ArrowClockwise,
  ArrowDown,
  Bell,
  CheckCircle,
  CreditCard,
  GitDiff,
  GlobeHemisphereWest,
  PlugsConnected,
  SkipForward,
  TrendDown,
  Warning,
  WifiSlash,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import type { NotificationType, NotificationView } from "@scanpal/shared";
import { emitNotificationsChanged } from "@/lib/notifications-events";

const TYPE_LABELS: Record<NotificationType, string> = {
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

// Tint follows the light "luminous-technical-calm" idiom: flat tinted tile,
// one of a small set of semantic tones (success / warning / danger / info / neutral).
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TYPE_META: Record<NotificationType, { icon: Icon; tone: Tone }> = {
  scan_done: { icon: CheckCircle, tone: "success" },
  score_drop: { icon: TrendDown, tone: "warning" },
  scan_diff: { icon: GitDiff, tone: "info" },
  site_down: { icon: WifiSlash, tone: "danger" },
  site_recovered: { icon: ArrowClockwise, tone: "success" },
  critical_finding: { icon: Warning, tone: "danger" },
  credit_skip: { icon: SkipForward, tone: "neutral" },
  scan_failed: { icon: XCircle, tone: "danger" },
  webhook_disabled: { icon: PlugsConnected, tone: "neutral" },
  payment_failed: { icon: CreditCard, tone: "danger" },
  domain_alert: { icon: GlobeHemisphereWest, tone: "warning" },
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
      // Count is unknown here (this list may be filtered); let listeners
      // re-fetch the authoritative server count.
      emitNotificationsChanged();
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
      emitNotificationsChanged({ unread: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    }
  }

  return (
    <section className="notifications-panel">
      {error && (
        <p className="workspace-alert is-error" role="alert">
          {error}
        </p>
      )}

      <div className="notifications-toolbar" aria-label="Meldingen filteren">
        <div className="notifications-filter" role="tablist" aria-label="Filter meldingen">
          {(["all", "unread"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={filter === option}
              onClick={() => switchFilter(option)}
              disabled={loading}
              className={`notifications-filter-pill${filter === option ? " is-active" : ""}`}
            >
              {option === "all" ? "Alle" : `Ongelezen (${unread})`}
            </button>
          ))}
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="notifications-mark-all"
          >
            <CheckCircle size={15} aria-hidden="true" />
            Alles als gelezen markeren
          </button>
        )}
      </div>

      <div className={`notifications-archive${loading ? " is-loading" : ""}`} aria-busy={loading}>
        {items.length === 0 ? (
          <div className="notifications-empty-state">
            <span className="notifications-empty-icon">
              <Bell size={22} aria-hidden="true" />
            </span>
            <div>
              <strong>Geen meldingen</strong>
              <p>
                {filter === "unread"
                  ? "Je hebt geen ongelezen meldingen."
                  : "Nieuwe meldingen over scans, uptime en bevindingen verschijnen hier."}
              </p>
            </div>
          </div>
        ) : (
          <ul className="notifications-list">
            {items.map((notification) => {
              const meta = TYPE_META[notification.type];
              const NotificationIcon = meta.icon;
              const isUnread = !notification.read_at;
              return (
                <li
                  key={notification.id}
                  className={`notification-row${isUnread ? " is-unread" : ""}`}
                >
                  <span
                    className={`notification-icon is-${meta.tone}`}
                    aria-hidden="true"
                  >
                    <NotificationIcon size={19} />
                  </span>
                  <Link
                    href={notification.link}
                    className="notification-body"
                    onClick={() => void markRead(notification)}
                  >
                    <div className="notification-meta">
                      <span className={`notification-tag is-${meta.tone}`}>
                        {TYPE_LABELS[notification.type]}
                      </span>
                      {isUnread && <span className="notification-dot" aria-label="Ongelezen" />}
                      <time>{formatTime(notification.created_at)}</time>
                    </div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                  </Link>
                  {isUnread && (
                    <button
                      type="button"
                      disabled={busyId === notification.id}
                      onClick={() => void markRead(notification)}
                      className="notification-mark-read"
                    >
                      Markeer gelezen
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {items.length < total && (
          <div className="notifications-pagination">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className="dashboard-light-button"
            >
              <ArrowDown size={16} aria-hidden="true" />
              {loading ? "Laden…" : "Meer laden"}
            </button>
          </div>
        )}
      </div>

      <p className="notifications-note">
        Meldingen ouder dan 90 dagen worden automatisch opgeruimd. Je voorkeuren
        beheer je op{" "}
        <Link href="/settings/notifications">Notificatievoorkeuren</Link>.
      </p>
    </section>
  );
}
