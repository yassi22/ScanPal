import Link from "next/link";

/** Free-plan-upsell voor het threats-paneel (Pro-only, plan 12). */
export function ThreatsUpsell() {
  return (
    <section className="threats-upsell">
      <div><strong>Threat monitoring starts on Pro</strong><p>Give each property a private honeypot route, detect repeated probes and suspicious paths, and review the evidence in one live incident ledger.</p></div>
      <Link
        href="/billing"
        className="dashboard-primary-button"
      >
        Review Pro
      </Link>
    </section>
  );
}
