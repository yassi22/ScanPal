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
    <div className="dashboard-home settings-webhooks-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading settings-webhooks-heading">
        <div>
          <h1>Events, rechtstreeks naar je eigen endpoint.</h1>
          <p>
            Ontvang HMAC-gesigneerde JSON-payloads op je eigen endpoint bij elk
            notificatie-event.
          </p>
        </div>
        <span className="dashboard-plan-chip">
          {webhooks.length} {webhooks.length === 1 ? "webhook" : "webhooks"}
        </span>
      </header>

      <SettingsNav />

      <WebhooksSettings isOwner={isOwner} initialWebhooks={webhooks} />

      <footer className="dashboard-page-footer">
        <span>Elke bezorging gesigneerd, met retry en backoff.</span>
        <span>ScanPal · Webhooks</span>
      </footer>
    </div>
  );
}
