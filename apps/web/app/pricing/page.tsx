import Link from "next/link";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { planList } from "@scanpal/shared";
import { createClient } from "@/lib/supabase/server";
import { PricingCards } from "@/components/pricing-cards";

export const metadata = {
  title: "Pricing — ScanPal",
};

type PricingPageProps = {
  searchParams: Promise<{ checkout?: string | string[] }>;
};

const directionContract = `<!--
THESIS: Pricing should feel like one calm decision surface, not a stack of loud SaaS cards.
OWN-WORLD: Luminous paper, cool blue-grey atmosphere, ink typography, quiet rules, and black pill actions.
STORY: Compare the real plans, choose a billing rhythm, and continue without pressure or hidden state.
FIRST VIEWPORT: Transparent public navigation, compact promise, billing control, and the comparison sheet entering the frame.
FORM: Structured comparison sheet; direct narrow extension; seed key pricing-house-style-v1.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const { checkout } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const checkoutCanceled = checkout === "canceled";

  return (
    <div className="pricing-shell">
      <template
        id="scanpal-pricing-design-contract"
        dangerouslySetInnerHTML={{ __html: directionContract }}
      />

      <header className="pricing-header">
        <div className="pricing-header-inner">
          <Link href="/" className="pricing-brand" aria-label="ScanPal home">
            <span className="pricing-brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            ScanPal
          </Link>

          <nav className="pricing-nav" aria-label="Primary navigation">
            <Link
              href="/pricing"
              className="pricing-nav-link is-active"
              aria-current="page"
            >
              Pricing
            </Link>
            {user ? (
              <Link href="/dashboard" className="pricing-nav-action">
                Dashboard
                <ArrowRight size={15} weight="bold" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="pricing-nav-link pricing-login-link">
                  Inloggen
                </Link>
                <Link href="/register" className="pricing-nav-action">
                  Gratis starten
                  <ArrowRight size={15} weight="bold" aria-hidden="true" />
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="pricing-main">
        {checkoutCanceled && (
          <div className="pricing-checkout-notice" role="status">
            <CheckCircle size={20} weight="regular" aria-hidden="true" />
            <div>
              <strong>Checkout geannuleerd</strong>
              <span>
                Er is niets in rekening gebracht. Je kunt rustig verder vergelijken.
              </span>
            </div>
          </div>
        )}

        <section className="pricing-hero" aria-labelledby="pricing-title">
          <h1 id="pricing-title">Simpele prijzen, geen verrassingen</h1>
          <p>
            Start gratis en upgrade wanneer je meer scans, uptime-monitoring of
            GitHub-scans nodig hebt.
          </p>
        </section>

        <section className="pricing-comparison" aria-label="ScanPal plans">
          <PricingCards plans={planList} signedIn={user !== null} />
        </section>

        <section className="pricing-bottom-note" aria-label="Billing information">
          <p>
            Alle plan- en factuurinstellingen blijven na het upgraden beschikbaar
            vanuit je ScanPal-billingpagina.
          </p>
          <Link href={user ? "/billing" : "/register"}>
            {user ? "Naar billing" : "Begin met Free"}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Link>
        </section>
      </main>

      <footer className="pricing-footer">
        <span>ScanPal</span>
        <span>Website health, made clear.</span>
      </footer>
    </div>
  );
}
