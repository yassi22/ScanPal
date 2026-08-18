import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getTeamUsage } from "@/lib/credits";
import { getSubscriptionView } from "@/lib/billing";
import { plans, isPaidPlan } from "@scanpal/shared";
import { BillingManager } from "@/components/billing-manager";

const STATUS_LABELS: Record<string, string> = {
  active: "Actief",
  trialing: "Proef",
  past_due: "Achterstallig",
  canceled: "Geannuleerd",
};

export default async function BillingPage() {
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

  const [usage, subscription] = await Promise.all([
    getTeamUsage(pool, result.team.id),
    getSubscriptionView(pool, result.team.id),
  ]);
  const plan = plans[usage.plan.id];
  const isPaid = isPaidPlan(plan.id);
  const isOwner = result.membership.role === "owner";
  const usedPct = usage.creditsLimit > 0
    ? Math.min(100, Math.round((usage.creditsUsed / usage.creditsLimit) * 100))
    : 100;

  return (
    <div>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-sm text-slate-400">
        Huidig plan en verbruik van {result.team.name}.
      </p>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold">{plan.name}</h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  subscription.status === "active" || subscription.status === "trialing"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : subscription.status === "past_due"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-red-500/15 text-red-400"
                }`}
              >
                {STATUS_LABELS[subscription.status] ?? subscription.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {plan.id === "max"
                ? `${plan.creditsPerPeriod} scans per ${subscription.interval === "year" ? "jaar" : "maand"} · ${plan.features.seats ?? plan.maxMembers} betaalde seats · white-label branding`
                : isPaid
                  ? `${plan.creditsPerPeriod} scans per ${subscription.interval === "year" ? "jaar" : "maand"} · ${plan.maxMembers} teamleden · uptime & GitHub-scans`
                  : `${plan.creditsPerPeriod} scans per maand · ${plan.maxMembers} teamleden`}
            </p>
            {isPaid && (
              <p className="mt-1 text-xs text-slate-500">
                {subscription.cancel_at_period_end && subscription.current_period_end
                  ? `Stopt op ${new Date(subscription.current_period_end).toLocaleDateString("nl-NL")}`
                  : subscription.current_period_end
                    ? `Verlengt op ${new Date(subscription.current_period_end).toLocaleDateString("nl-NL")} · per ${subscription.interval === "year" ? "jaar" : "maand"}`
                    : `Per ${subscription.interval === "year" ? "jaar" : "maand"}`}
                {subscription.default_payment_method && (
                  <>
                    {" · "}
                    {subscription.default_payment_method.brand}{" "}
                    •••• {subscription.default_payment_method.last4} (
                    {subscription.default_payment_method.exp_month}/
                    {subscription.default_payment_method.exp_year})
                  </>
                )}
              </p>
            )}
          </div>

          <BillingManager
            isOwner={isOwner}
            isPaid={isPaid}
            subscription={subscription}
          />
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Verbruik deze periode</span>
            <span className="font-semibold">
              {usage.creditsUsed} / {usage.creditsLimit} scans
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${
                usedPct >= 100
                  ? "bg-red-500"
                  : usedPct >= 80
                    ? "bg-amber-500"
                    : "bg-brand"
              }`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {usage.resetAt
              ? `Reset op ${new Date(usage.resetAt).toLocaleDateString("nl-NL")}`
              : "Verbruik wordt per maand gereset"}
          </p>
        </div>

        {subscription.status === "past_due" && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm text-amber-400">
              Betalingsachterstand — scans zijn gepauzeerd. Werk je
              betaalmethode bij om verder te gaan.
            </p>
            <BillingManager.PortalButton />
          </div>
        )}
      </div>

      <div className="mt-8">
        <BillingManager.Invoices />
      </div>
    </div>
  );
}
