import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";

export default async function DashboardHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = user
    ? await ensureUserTeam(pool, {
        id: user.id,
        email: user.email ?? "",
        name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        auth_provider: user.app_metadata?.provider ?? null,
      })
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-400">
        {result?.team.name} — dit wordt straks je overzicht van sites, scans en
        bevindingen.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="font-semibold">Nieuwe scan starten</h2>
          <p className="mt-2 text-sm text-slate-400">
            Voer een URL in en laat ScanPal 100+ checks uitvoeren.
          </p>
          <Link
            href="/onboarding"
            className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Scan een website
          </Link>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="font-semibold">Uptime monitoring</h2>
          <p className="mt-2 text-sm text-slate-400">
            Binnenkort beschikbaar: controleer of je sites online blijven.
          </p>
        </div>
      </div>
    </div>
  );
}
