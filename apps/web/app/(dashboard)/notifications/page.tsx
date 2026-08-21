import Link from "next/link";
import { pool } from "@/lib/db";
import { listNotifications } from "@/lib/notifications-core";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { NotificationsUnreadChip } from "@/components/notifications/notifications-unread-chip";
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
    <div className="dashboard-home notifications-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading notifications-page-heading">
        <div>
          <h1>Meldingen, gebundeld en gerangschikt.</h1>
          <p>
            Scan-, uptime- en finding-signalen voor je account, dicht bij de
            gebeurtenis die ze veroorzaakte.
          </p>
        </div>
        <div className="dashboard-heading-actions">
          <NotificationsUnreadChip initialUnread={initial.unread} />
          <Link href="/settings/notifications" className="dashboard-light-button">
            Voorkeuren beheren
          </Link>
        </div>
      </header>

      <NotificationsList
        initial={initial.notifications}
        initialUnread={initial.unread}
        initialTotal={initial.total}
      />

      <footer className="dashboard-page-footer">
        <span>Signalen boven ruis, altijd met bewijs.</span>
        <span>ScanPal · Meldingen</span>
      </footer>
    </div>
  );
}
