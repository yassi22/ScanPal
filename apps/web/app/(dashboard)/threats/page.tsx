import { pool } from "@/lib/db";
import { getPlanForTeam } from "@/lib/credits";
import { listThreatOverviews, listThreatRules } from "@/lib/threats-core";
import { ThreatsOverview } from "@/components/threats/threats-overview";
import { ThreatEvents } from "@/components/threats/threat-events";
import { ThreatsUpsell } from "@/components/threats/threats-upsell";
import { RiskBadge } from "@/components/threats/risk-badge";
import type { ThreatRuleKey } from "@scanpal/shared";
import { isPaidPlan } from "@scanpal/shared";
import { getDashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

const RULE_ADVICE: Record<ThreatRuleKey, string> = {
  burst: "Block the IP or add rate limiting to the affected route.",
  path_admin: "Protect admin paths with stronger authentication or move them.",
  path_env:
    "Confirm these files are private and rotate any exposed token.",
  path_traversal:
    "Review access logs immediately and block the source when confirmed.",
  ua_scanner: "Likely automated reconnaissance; monitor before escalating.",
  ip_repeat:
    "Repeated probes from one source; consider blocking the IP range.",
};

export default async function ThreatsPage() {
  const result = await getDashboardContext();

  const plan = await getPlanForTeam(pool, result.team.id);
  if (!isPaidPlan(plan.id)) {
    return (
      <div className="dashboard-home threats-page" data-design-direction="luminous-technical-calm">
        <header className="dashboard-page-heading threats-page-heading">
          <div>
            <h1>See reconnaissance before it becomes noise.</h1>
            <p>Honeypot telemetry and pattern detection for probes, scanners, and suspicious paths.</p>
          </div>
          <span className="dashboard-plan-chip">Pro capability</span>
        </header>
        <ThreatsUpsell />
        <footer className="dashboard-page-footer"><span>Detection stays evidence-led.</span><span>ScanPal · Threats</span></footer>
      </div>
    );
  }

  const [overviews, rules] = await Promise.all([
    listThreatOverviews(pool, result.team.id),
    listThreatRules(pool),
  ]);

  return (
    <div className="dashboard-home threats-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading threats-page-heading">
        <div>
          <h1>See reconnaissance before it becomes noise.</h1>
          <p>
            Each property receives a private honeypot route. Every hit is logged,
            grouped into patterns, and kept close to the response it may require.
          </p>
        </div>
        <span className="dashboard-plan-chip">
          {overviews.length} {overviews.length === 1 ? "honeypot" : "honeypots"}
        </span>
      </header>

      <ThreatsOverview initial={overviews} />

      <section className="threat-events-section">
        <div className="workspace-section-heading">
          <div><h2>Incident ledger</h2><p>Filter the evidence by severity, signal type, or property.</p></div>
        </div>
        <ThreatEvents honeypots={overviews.map((o) => o.site)} />
      </section>

      <section className="threat-rules-section">
        <div className="workspace-section-heading">
          <div><h2>Detection rules</h2><p>The patterns ScanPal evaluates when honeypot traffic arrives.</p></div>
        </div>
        <div className="threat-rule-list">
          {rules.map((rule) => (
            <article key={rule.id} className="threat-rule-row">
              <div><strong>{rule.name}</strong><p>{rule.description}</p></div>
              <RiskBadge risk={rule.risk} />
              <p><span>Recommended response</span>{RULE_ADVICE[rule.rule_key]}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="dashboard-page-footer"><span>Detection stays evidence-led.</span><span>ScanPal · Threats</span></footer>
    </div>
  );
}
