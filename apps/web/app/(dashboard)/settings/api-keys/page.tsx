import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listApiKeys } from "@/lib/api-keys-core";
import { SettingsNav } from "@/components/settings-nav";
import { ApiKeysSettings } from "@/components/api-keys-settings";

export default async function SettingsApiKeysPage() {
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

  const isOwner = result.membership.role === "owner";
  const keys = isOwner ? await listApiKeys(pool, result.team.id) : [];

  return (
    <div>
      <h1 className="text-2xl font-bold">API-keys</h1>
      <p className="mt-1 text-sm text-slate-400">
        Keys voor de ScanPal REST API en de MCP-server. Gebruik ze in de{" "}
        <code className="text-slate-300">Authorization: Bearer</code> header.
      </p>

      <SettingsNav />

      <ApiKeysSettings
        isOwner={isOwner}
        initialKeys={keys}
      />
    </div>
  );
}
