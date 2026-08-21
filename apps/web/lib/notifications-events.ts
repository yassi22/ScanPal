import { useCallback, useEffect, useState } from "react";

/**
 * Client-side signal that the unread-notification count changed. The bell badge
 * and the page-heading chip live in separate React trees (the bell is in the
 * persistent dashboard layout, which does not re-render on soft navigation), so
 * marking notifications read needs an explicit broadcast to keep them in sync
 * instead of waiting for the 60s poll or a window refocus.
 */
export const NOTIFICATIONS_CHANGED_EVENT = "scanpal:notifications-changed";

type NotificationsChangedDetail = { unread?: number };

/** Broadcast an unread-count change. Pass `unread` when the new count is known
 * (e.g. mark-all-read → 0) for an instant update; omit it to have listeners
 * re-fetch the authoritative server count. */
export function emitNotificationsChanged(
  detail: NotificationsChangedDetail = {},
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail }),
  );
}

/**
 * Shared unread-count state. Seeds from a server-rendered value, then keeps
 * itself current via the change event (and, when `poll` is set, a 60s poll plus
 * window-focus refresh). The server count is always the source of truth.
 */
export function useUnreadCount(
  initialUnread: number,
  options: { poll?: boolean } = {},
): number {
  const { poll = false } = options;
  const [unread, setUnread] = useState(initialUnread);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=true&limit=1");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.unread === "number") setUnread(data.unread);
    } catch {
      // netwerkfout — telling ongewijzigd laten
    }
  }, []);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsChangedDetail>).detail;
      if (detail && typeof detail.unread === "number") {
        setUnread(Math.max(0, detail.unread));
      } else {
        void refresh();
      }
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
  }, [refresh]);

  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => void refresh(), 60000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll, refresh]);

  return unread;
}
