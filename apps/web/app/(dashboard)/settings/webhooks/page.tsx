import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { listWebhooks } from "@/lib/webhooks-core";
import { SettingsNav } from "@/components/settings-nav";
import { WebhooksSettings } from "@/components/webhooks-settings";

export default async function SettingsWebhooksPage() {
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
  const webhooks = await listWebhooks(pool, result.team.id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Webhooks</h1>
      <p className="mt-1 text-sm text-slate-400">
        Ontvang HMAC-gesigneerde JSON-payloads op je eigen endpoint bij elk
        notificatie-event.
      </p>

      <SettingsNav />

      <WebhooksSettings isOwner={isOwner} initialWebhooks={webhooks} />
    </div>
  );
}
