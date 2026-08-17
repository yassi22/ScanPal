import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { listThreatOverviews, listThreatRules } from "@/lib/threats-core";
import { ThreatsOverview } from "@/components/threats/threats-overview";
import { ThreatEvents } from "@/components/threats/threat-events";
import { ThreatsUpsell } from "@/components/threats/threats-upsell";
import { RiskBadge } from "@/components/threats/risk-badge";
import type { ThreatRuleKey } from "@scanpal/shared";

export const dynamic = "force-dynamic";

const RULE_ADVICE: Record<ThreatRuleKey, string> = {
  burst: "Blokkeer het IP of voeg rate-limiting toe op je site.",
  path_admin: "Beveilig beheerpaden extra (wachtwoord/2FA) of verplaats ze.",
  path_env:
    "Controleer dat deze bestanden echt niet publiek staan en roteer de token.",
  path_traversal:
    "Direct mogelijke aanval — bekijk je access-logs en blokkeer het IP.",
  ua_scanner: "Waarschijnlijk een geautomatiseerde scan; weinig actie nodig.",
  ip_repeat:
    "Herhaalde probes vanaf één IP — overweeg het IP(-range) te blokkeren.",
};

export default async function ThreatsPage() {
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

  const plan = await getPlanForTeam(pool, result.team.id);
  if (plan.id !== "pro") {
    return (
      <div>
        <h1 className="text-2xl font-bold">Threats</h1>
        <p className="mt-1 text-sm text-slate-400">
          Honeypot + patroon-detectie tegen probes en aanvallen.
        </p>
        <ThreatsUpsell />
      </div>
    );
  }

  const [overviews, rules] = await Promise.all([
    listThreatOverviews(pool, result.team.id),
    listThreatRules(pool),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Threats</h1>
      <p className="mt-1 text-sm text-slate-400">
        Honeypot per site: plaats de geheime URL op je site; elke hit wordt
        gelogd en op aanvalspatronen geanalyseerd.
      </p>

      <ThreatsOverview initial={overviews} />

      <h2 className="mt-12 text-lg font-semibold text-slate-100">Events</h2>
      <ThreatEvents honeypots={overviews.map((o) => o.site)} />

      <h2 className="mt-12 text-lg font-semibold text-slate-100">
        Patroon-detectie
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-100">{rule.name}</p>
              <RiskBadge risk={rule.risk} />
            </div>
            <p className="mt-1 text-sm text-slate-400">{rule.description}</p>
            <p className="mt-2 text-xs text-slate-500">
              Advies: {RULE_ADVICE[rule.rule_key]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
