import { NotificationPreferences } from "@/components/notifications/notification-preferences";
import { SettingsNav } from "@/components/settings-nav";

export default async function SettingsNotificationsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Notificatievoorkeuren</h1>
      <p className="mt-1 text-sm text-slate-400">
        Kies per type welke meldingen je per e-mail en in-app ontvangt. De
        standaardinstellingen zijn: alles aan, behalve &ldquo;Scan
        voltooid&rdquo;.
      </p>

      <SettingsNav />

      <NotificationPreferences />
    </div>
  );
}
