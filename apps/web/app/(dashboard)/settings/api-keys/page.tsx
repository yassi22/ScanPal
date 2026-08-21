import { pool } from "@/lib/db";
import { listApiKeys } from "@/lib/api-keys-core";
import { SettingsNav } from "@/components/settings-nav";
import { ApiKeysSettings } from "@/components/api-keys-settings";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function SettingsApiKeysPage() {
  const result = await getDashboardContext();

  const isOwner = result.membership.role === "owner";
  const keys = isOwner ? await listApiKeys(pool, result.team.id) : [];

  return (
    <div className="dashboard-home settings-api-keys-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading settings-api-keys-heading">
        <div>
          <h1>Sleutels voor de API en MCP-server.</h1>
          <p>
            Keys voor de ScanPal REST API en de MCP-server. Gebruik ze in de{" "}
            <strong>Authorization: Bearer</strong> header.
          </p>
        </div>
        <span className="dashboard-plan-chip">
          {keys.length} {keys.length === 1 ? "key" : "keys"}
        </span>
      </header>

      <SettingsNav />

      <ApiKeysSettings isOwner={isOwner} initialKeys={keys} />

      <footer className="dashboard-page-footer">
        <span>Alleen een hash wordt bewaard, nooit de key zelf.</span>
        <span>ScanPal · API-keys</span>
      </footer>
    </div>
  );
}
