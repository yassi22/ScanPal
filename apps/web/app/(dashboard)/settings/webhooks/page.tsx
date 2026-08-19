import { pool } from "@/lib/db";
import { listWebhooks } from "@/lib/webhooks-core";
import { SettingsNav } from "@/components/settings-nav";
import { WebhooksSettings } from "@/components/webhooks-settings";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function SettingsWebhooksPage() {
  const result = await getDashboardContext();

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
