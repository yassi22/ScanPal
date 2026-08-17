import "server-only";

import type { Pool } from "pg";
import { notificationTypes, type NotificationPreference, type NotificationType, type NotificationView } from "@scanpal/shared";
import { defaultEnabled } from "@scanpal/notify";

type NotificationRow = {
  id: string;
  team_id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    team_id: row.team_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    link: row.link,
    payload: row.payload,
    read_at: row.read_at ? row.read_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

export type NotificationListResult = {
  notifications: NotificationView[];
  /** Ongerelateerd aan de filters: ongelezen-telling voor de bel-badge. */
  unread: number;
  /** Alle meldingen van de gebruiker (voor pagination-totalen). */
  total: number;
};

export async function listNotifications(
  db: Pool,
  input: {
    userId: string;
    unread?: boolean;
    type?: NotificationType;
    limit: number;
    offset: number;
  },
): Promise<NotificationListResult> {
  const conditions = ["user_id = $1"];
  const params: unknown[] = [input.userId];
  if (input.unread === true) {
    conditions.push("read_at is null");
  } else if (input.unread === false) {
    conditions.push("read_at is not null");
  }
  if (input.type) {
    params.push(input.type);
    conditions.push(`type = $${params.length}`);
  }
  const where = conditions.join(" and ");

  const [list, counts] = await Promise.all([
    db.query(
      `select id, team_id, type, title, body, link, payload, read_at, created_at
       from notifications
       where ${where}
       order by created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, input.limit, input.offset],
    ),
    db.query(
      `select
         count(*)::int as total,
         count(*) filter (where read_at is null)::int as unread
       from notifications
       where user_id = $1`,
      [input.userId],
    ),
  ]);

  return {
    notifications: (list.rows as NotificationRow[]).map(toView),
    unread: counts.rows[0].unread as number,
    total: counts.rows[0].total as number,
  };
}

/** Markeer één melding als gelezen (idempotent); null als hij niet van de user is. */
export async function countUnreadNotifications(
  db: Pool,
  userId: string,
): Promise<number> {
  const result = await db.query(
    "select count(*)::int as n from notifications where user_id = $1 and read_at is null",
    [userId],
  );
  return result.rows[0].n as number;
}

export async function markNotificationRead(
  db: Pool,
  userId: string,
  notificationId: string,
): Promise<NotificationView | null> {
  const result = await db.query(
    `update notifications set read_at = now()
     where id = $1 and user_id = $2
     returning id, team_id, type, title, body, link, payload, read_at, created_at`,
    [notificationId, userId],
  );
  if (result.rowCount === 0) return null;
  return toView(result.rows[0] as NotificationRow);
}

export async function markAllNotificationsRead(
  db: Pool,
  userId: string,
): Promise<number> {
  const result = await db.query(
    "update notifications set read_at = now() where user_id = $1 and read_at is null",
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function listNotificationPreferences(
  db: Pool,
  userId: string,
): Promise<NotificationPreference[]> {
  const result = await db.query<{ type: string; enabled: boolean }>(
    "select type, enabled from notification_preferences where user_id = $1",
    [userId],
  );
  const stored = new Map(result.rows.map((row) => [row.type, row.enabled]));
  return notificationTypes.map((type) => ({
    type,
    enabled: stored.get(type) ?? defaultEnabled[type],
  }));
}

export async function setNotificationPreference(
  db: Pool,
  userId: string,
  type: NotificationType,
  enabled: boolean,
): Promise<void> {
  await db.query(
    `insert into notification_preferences (user_id, type, enabled)
     values ($1, $2, $3)
     on conflict (user_id, type) do update set enabled = excluded.enabled`,
    [userId, type, enabled],
  );
}
