import Link from "next/link";
import { pool } from "@/lib/db";
import { listNotifications } from "@/lib/notifications-core";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { getDashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const { authUser } = await getDashboardContext();

  const initial = await listNotifications(pool, {
    userId: authUser.id,
    limit: 20,
    offset: 0,
  });

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Meldingen</h1>
        <Link
          href="/settings/notifications"
          className="text-sm text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline"
        >
          Voorkeuren beheren
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Scan-, uptime- en finding-meldingen voor je account.
      </p>

      <NotificationsList
        initial={initial.notifications}
        initialUnread={initial.unread}
        initialTotal={initial.total}
      />
    </div>
  );
}
