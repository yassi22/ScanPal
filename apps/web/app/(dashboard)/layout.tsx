import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { countUnreadNotifications } from "@/lib/notifications-core";
import { DashboardShell } from "@/components/dashboard-shell";

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
    <DashboardShell
      initialUnread={initialUnread}
      needsOnboarding={needsOnboarding}
      teamName={result.team.name}
    >
      {children}
    </DashboardShell>
  );
}
