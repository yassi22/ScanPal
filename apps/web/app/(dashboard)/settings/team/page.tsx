import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listMembers, listPendingInvitations } from "@/lib/invites-core";
import { TeamSettings } from "@/components/team-settings";

export default async function SettingsTeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await ensureUserTeam(pool, {
    id: user?.id ?? "",
    email: user?.email ?? "",
    name: user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null,
    avatar_url: user?.user_metadata?.avatar_url ?? null,
    auth_provider: user?.app_metadata?.provider ?? null,
  });

  const [members, invitations] = await Promise.all([
    listMembers(pool, result.team.id),
    listPendingInvitations(pool, result.team.id),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Team-instellingen</h1>
      <p className="mt-1 text-sm text-slate-400">
        Beheer leden en uitnodigingen voor {result.team.name}.
      </p>

      <TeamSettings
        teamId={result.team.id}
        teamName={result.team.name}
        isOwner={result.membership.role === "owner"}
        currentUserId={result.membership.user_id}
        members={members.map((m) => ({
          ...m,
          created_at:
            typeof m.created_at === "string" ? m.created_at : m.created_at.toISOString(),
        }))}
        invitations={invitations.map((i) => ({
          ...i,
          created_at:
            typeof i.created_at === "string" ? i.created_at : i.created_at.toISOString(),
          expires_at:
            typeof i.expires_at === "string" ? i.expires_at : i.expires_at.toISOString(),
        }))}
      />
    </div>
  );
}
