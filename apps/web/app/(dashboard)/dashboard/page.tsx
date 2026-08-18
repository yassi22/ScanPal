import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";

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

  const plan = result ? await getPlanForTeam(pool, result.team.id) : null;
  const needsOnboarding = result?.user.onboarding_completed_at === null;

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
            href={needsOnboarding ? "/onboarding" : "/sites"}
            className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Scan een website
          </Link>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Uptime monitoring</h2>
            {!plan?.features.uptime && (
              <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                Pro
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {plan?.features.uptime
              ? "Controleer of je sites online blijven."
              : "Beschikbaar op Pro: controleer of je sites online blijven."}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">GitHub-scans</h2>
            {!plan?.features.github && (
              <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                Pro
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {plan?.features.github
              ? "Scan repositories op geheimen, SAST-issues en kwetsbare dependencies."
              : "Beschikbaar op Pro: scan repositories op geheimen en kwetsbaarheden."}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Plan</h2>
            <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
              {plan?.name ?? "Free"}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Bekijk je verbruik en beheer je abonnement.
          </p>
          <Link
            href="/billing"
            className="mt-4 inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold transition hover:border-slate-500"
          >
            Naar billing
          </Link>
        </div>
      </div>
    </div>
  );
}
