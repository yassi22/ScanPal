import type { SiteStatus } from "@scanpal/shared";
import { statusLabel } from "@/lib/uptime-format";

const DOT_COLORS: Record<SiteStatus, string> = {
  up: "bg-emerald-400",
  down: "bg-red-500",
  unknown: "bg-slate-500",
};

export function StatusDot({ state }: { state: SiteStatus }) {
  return (
    <span className={`uptime-status-dot is-${state} inline-flex items-center gap-2`}>
      <span
        className={`h-2.5 w-2.5 rounded-full ${DOT_COLORS[state]}`}
        aria-hidden
      />
      <span className="uptime-status-label text-sm text-slate-200">{statusLabel(state)}</span>
    </span>
  );
}
