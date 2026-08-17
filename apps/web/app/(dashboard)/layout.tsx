import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { countUnreadNotifications } from "@/lib/notifications-core";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const result = await ensureUserTeam(pool, {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    auth_provider: user.app_metadata?.provider ?? null,
  });

  const needsOnboarding = result.user.onboarding_completed_at === null;
  const initialUnread = await countUnreadNotifications(pool, user.id);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            Scan<span className="text-brand">Pal</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            {!needsOnboarding && (
              <Link
                href="/dashboard"
                className="transition hover:text-slate-200"
              >
                Dashboard
              </Link>
            )}
            {!needsOnboarding && (
              <Link
                href="/sites"
                className="transition hover:text-slate-200"
              >
                Sites
              </Link>
            )}
            {!needsOnboarding && (
              <Link
                href="/reports"
                className="transition hover:text-slate-200"
              >
                Rapporten
              </Link>
            )}
            {!needsOnboarding && (
              <Link
                href="/uptime"
                className="transition hover:text-slate-200"
              >
                Uptime
              </Link>
            )}
            {!needsOnboarding && (
              <Link
                href="/threats"
                className="transition hover:text-slate-200"
              >
                Threats
              </Link>
            )}
            {!needsOnboarding && (
              <Link
                href="/settings/team"
                className="transition hover:text-slate-200"
              >
                Team
              </Link>
            )}
            {!needsOnboarding && (
              <Link
                href="/billing"
                className="transition hover:text-slate-200"
              >
                Billing
              </Link>
            )}
            {!needsOnboarding && <NotificationBell initialUnread={initialUnread} />}
            <span className="hidden text-slate-600 sm:inline">{result.team.name}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
