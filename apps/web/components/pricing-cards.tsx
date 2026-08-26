"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "@phosphor-icons/react";
import type { PlanId, PublicPlan, SubscriptionInterval } from "@scanpal/shared";

type UsageState = {
  plan: { id: PlanId };
} | null;

function formatPrice(priceCents: number): string {
  if (priceCents === 0) return "€0";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("nl-NL").format(value);
}

const planDescriptions: Record<PlanId, string> = {
  free: "Voor een eerste indruk en incidentele scans.",
  pro: "Voor websites die doorlopend bewaakt en verbeterd worden.",
  max: "Voor kleine teams met meer volume en white-label rapporten.",
};

export function PricingCards({
  plans,
  signedIn,
}: {
  plans: PublicPlan[];
  signedIn: boolean;
}) {
  const [usage, setUsage] = useState<UsageState>(null);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [interval, setInterval] = useState<SubscriptionInterval>("month");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/billing/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(data))
      .catch(() => {});
  }, [signedIn]);

  async function checkout(planId: PlanId) {
    setBusy(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, interval }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Checkout starten mislukt");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout starten mislukt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pricing-plans">
      <div className="pricing-controls">
        <div className="pricing-interval" aria-label="Facturatieperiode">
          <button
            type="button"
            className={interval === "month" ? "is-active" : ""}
            aria-pressed={interval === "month"}
            onClick={() => setInterval("month")}
          >
            Maandelijks
          </button>
          <button
            type="button"
            className={interval === "year" ? "is-active" : ""}
            aria-pressed={interval === "year"}
            onClick={() => setInterval("year")}
          >
            Jaarlijks
          </button>
        </div>
        <span className="pricing-saving">2 maanden gratis bij jaarbetaling</span>
      </div>

      <p className="pricing-tax-note">
        Prijzen exclusief btw — btw wordt toegevoegd op de factuur.
      </p>

      {error && (
        <p className="pricing-error" role="alert">
          {error} Probeer het opnieuw of kies een ander plan.
        </p>
      )}

      <div className="pricing-plan-grid">
        {plans.map((plan) => {
          const isCurrent = usage?.plan?.id === plan.id;
          const isFeatured = plan.id === "max";
          const priceCents =
            interval === "year" && plan.annualPriceCents
              ? plan.annualPriceCents
              : plan.priceCents;
          const monthlyEquivalent =
            interval === "year" && plan.annualPriceCents
              ? plan.annualPriceCents / 12
              : null;

          const features = [
            {
              included: true,
              label: `${formatInteger(plan.creditsPerPeriod)} scans per ${
                plan.priceCents === 0 || interval === "month" ? "maand" : "jaar"
              }`,
            },
            {
              included: true,
              label:
                plan.features.seats !== null
                  ? `${plan.features.seats} betaalde seats`
                  : `Maximaal ${plan.maxMembers} teamleden`,
            },
            { included: plan.features.uptime, label: "Uptime monitoring" },
            { included: plan.features.github, label: "GitHub-reposcans" },
            { included: plan.features.white_label, label: "White-label branding" },
          ];

          return (
            <article
              key={plan.id}
              className={`pricing-plan${isFeatured ? " is-featured" : ""}`}
            >
              <div className="pricing-plan-head">
                <div className="pricing-plan-name-row">
                  <h2>{plan.name}</h2>
                  {isFeatured && <span>Meest compleet</span>}
                </div>
                <p>{planDescriptions[plan.id]}</p>
              </div>

              <div className="pricing-price-block">
                <p className="pricing-price">
                  <span>{formatPrice(priceCents)}</span>
                  {plan.priceCents !== 0 && (
                    <span className="pricing-price-period">
                      /{interval === "year" ? "jaar" : "maand"}
                    </span>
                  )}
                </p>
                <div className="pricing-price-context">
                  {monthlyEquivalent !== null ? (
                    <span>{formatPrice(monthlyEquivalent)} per maand</span>
                  ) : plan.priceCents === 0 ? (
                    <span>Geen betaalgegevens nodig</span>
                  ) : (
                    <span>Maandelijks opzegbaar</span>
                  )}
                </div>
              </div>

              <ul className="pricing-feature-list">
                {features.map((feature) => {
                  const FeatureIcon = feature.included ? Check : Minus;
                  return (
                    <li
                      key={feature.label}
                      className={feature.included ? "" : "is-muted"}
                    >
                      <FeatureIcon size={17} weight="bold" aria-hidden="true" />
                      <span>
                        {!feature.included && (
                          <span className="sr-only">Niet inbegrepen: </span>
                        )}
                        {feature.label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="pricing-plan-action">
                {isCurrent ? (
                  <Link href="/billing" className="pricing-button is-secondary">
                    Huidig plan — beheren
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </Link>
                ) : !signedIn ? (
                  <Link
                    href="/register"
                    className={`pricing-button${isFeatured ? " is-primary" : " is-secondary"}`}
                  >
                    {plan.id === "free" ? "Start gratis" : "Aanmelden en upgraden"}
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </Link>
                ) : plan.id === "free" ? (
                  <Link href="/dashboard" className="pricing-button is-secondary">
                    Naar dashboard
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => checkout(plan.id)}
                    className="pricing-button is-primary"
                  >
                    {busy === plan.id
                      ? "Checkout openen…"
                      : `Upgrade naar ${plan.name}`}
                    {busy !== plan.id && (
                      <ArrowRight size={16} weight="bold" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
