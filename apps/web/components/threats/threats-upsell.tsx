import Link from "next/link";

/** Free-plan-upsell voor het threats-paneel (Pro-only, plan 12). */
export function ThreatsUpsell() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center">
      <p className="text-lg font-bold text-slate-100">
        Threat-monitoring is een Pro-functie
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
        Met Pro krijg je per site een geheime honeypot-URL, patroon-detectie
        (bursts, verdachte paden, scanner-tools) en een real-time
        events-paneel.
      </p>
      <Link
        href="/billing"
        className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
      >
        Upgrade naar Pro
      </Link>
    </div>
  );
}
