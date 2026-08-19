import { pool } from "@/lib/db";
import { countUnreadNotifications } from "@/lib/notifications-core";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const result = await getDashboardContext();

  const needsOnboarding = result.user.onboarding_completed_at === null;
  const initialUnread = await countUnreadNotifications(pool, result.authUser.id);

  return (
    <DashboardShell
      initialUnread={initialUnread}
      needsOnboarding={needsOnboarding}
      teamName={result.team.name}
    >
      {children}
    </DashboardShell>
  );
}
