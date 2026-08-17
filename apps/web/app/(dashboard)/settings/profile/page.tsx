import { createClient } from "@/lib/supabase/server";
import { SettingsNav } from "@/components/settings-nav";
import { ProfileSettings } from "@/components/profile-settings";

export default async function SettingsProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      <h1 className="text-2xl font-bold">Profiel</h1>
      <p className="mt-1 text-sm text-slate-400">
        Je naam en avatar worden gebruikt in het hele account en in rapporten.
      </p>

      <SettingsNav />

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          E-mailadres: <span className="font-medium text-slate-200">{user?.email ?? "—"}</span>
        </p>
      </div>

      <ProfileSettings
        initialName={
          user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null
        }
        initialAvatarUrl={user?.user_metadata?.avatar_url ?? null}
      />
    </div>
  );
}
