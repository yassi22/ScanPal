import { NotificationPreferences } from "@/components/notifications/notification-preferences";
import { SettingsNav } from "@/components/settings-nav";

export default async function SettingsNotificationsPage() {
  return (
    <div className="dashboard-home notifications-settings-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading notifications-settings-heading">
        <div>
          <h1>Stem je meldingen af op wat telt.</h1>
          <p>
            Kies per type welke meldingen je per e-mail en in-app ontvangt.
            Standaard staat alles aan, behalve <strong>&ldquo;Scan
            voltooid&rdquo;</strong>.
          </p>
        </div>
      </header>

      <SettingsNav />

      <NotificationPreferences />

      <footer className="dashboard-page-footer">
        <span>Alleen de signalen die je wilt ontvangen.</span>
        <span>ScanPal · Notificatievoorkeuren</span>
      </footer>
    </div>
  );
}
