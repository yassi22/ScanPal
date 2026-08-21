import { SettingsNav } from "@/components/settings-nav";
import { ProfileSettings } from "@/components/profile-settings";
import { getDashboardContext } from "@/lib/dashboard-context";

export default async function SettingsProfilePage() {
  const { authUser: user } = await getDashboardContext();

  return (
    <div className="dashboard-home settings-profile-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading settings-profile-heading">
        <div>
          <h1>Je profiel, zichtbaar in elk rapport.</h1>
          <p>
            Je naam en avatar worden gebruikt in het hele account en in
            gegenereerde rapporten.
          </p>
        </div>
      </header>

      <SettingsNav />

      <div className="settings-stack">
        <section className="settings-card">
          <h2>Account</h2>
          <p className="settings-account-email">
            E-mailadres: <strong>{user.email ?? "—"}</strong>
          </p>
        </section>

        <ProfileSettings
          initialName={
            user.user_metadata?.full_name ?? user.user_metadata?.name ?? null
          }
          initialAvatarUrl={user.user_metadata?.avatar_url ?? null}
        />
      </div>

      <footer className="dashboard-page-footer">
        <span>Eén identiteit door je hele account heen.</span>
        <span>ScanPal · Profiel</span>
      </footer>
    </div>
  );
}
