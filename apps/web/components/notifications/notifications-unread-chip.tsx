"use client";

import { useUnreadCount } from "@/lib/notifications-events";

/** Heading chip showing the live unread count. Seeds from the server render and
 * stays in sync when notifications are marked read on this page. */
export function NotificationsUnreadChip({
  initialUnread,
}: {
  initialUnread: number;
}) {
  const unread = useUnreadCount(initialUnread);
  return <span className="dashboard-plan-chip">{unread} ongelezen</span>;
}
