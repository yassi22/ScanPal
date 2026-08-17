import type { ThreatRisk } from "@scanpal/shared";

const RISK_STYLES: Record<ThreatRisk, string> = {
  low: "border-slate-700 bg-slate-800/60 text-slate-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  critical: "border-red-500/30 bg-red-500/10 text-red-400",
};

const RISK_LABELS: Record<ThreatRisk, string> = {
  low: "Laag",
  medium: "Middel",
  high: "Hoog",
  critical: "Kritiek",
};

export function RiskBadge({ risk }: { risk: ThreatRisk }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${RISK_STYLES[risk]}`}
    >
      {RISK_LABELS[risk]}
    </span>
  );
}
