"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlanId, PublicPlan, SubscriptionInterval } from "@scanpal/shared";

type UsageState = {
  plan: { id: PlanId };
} | null;

function formatPrice(priceCents: number): string {
  if (priceCents === 0) return "€0";
  return `€${(priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2)}`;
}

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

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/billing/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(data))
      .catch(() => {});
  }, [signedIn]);

  async function checkout(planId: PlanId) {
    setBusy(planId);
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
      alert(err instanceof Error ? err.message : "Checkout starten mislukt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-center gap-3 text-sm">
        <span
          className={interval === "month" ? "font-semibold text-slate-100" : "text-slate-500"}
        >
          Maandelijks
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={interval === "year"}
          onClick={() => setInterval(interval === "month" ? "year" : "month")}
          className="relative h-6 w-11 rounded-full border border-slate-700 bg-slate-800 transition"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-brand transition-all ${
              interval === "year" ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
        <span
          className={interval === "year" ? "font-semibold text-slate-100" : "text-slate-500"}
        >
          Jaarlijks
          <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
            2 maanden gratis
          </span>
        </span>
      </div>
      <p className="mb-8 text-center text-xs text-slate-500">
        Prijzen exclusief btw — btw wordt toegevoegd op de factuur.
      </p>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = usage?.plan?.id === plan.id;
          const isFeatured = plan.id === "max";
          const priceCents =
            interval === "year" && plan.annualPriceCents
              ? plan.annualPriceCents
              : plan.priceCents;
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-8 ${
                isFeatured
                  ? "border-brand/40 bg-brand/5"
                  : "border-slate-800 bg-slate-900/50"
              }`}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-3 text-4xl font-bold">
                {formatPrice(priceCents)}
                <span className="text-base font-normal text-slate-400">
                  {plan.priceCents === 0
                    ? ""
                    : interval === "year"
                      ? "/jaar"
                      : "/maand"}
                </span>
              </p>
              {plan.annualPriceCents && interval === "year" && (
                <p className="mt-1 text-xs text-emerald-400">
                  {formatPrice(plan.priceCents)}/maand bij jaarbetaling
                </p>
              )}

              <ul className="mt-6 space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <span className="text-brand">✓</span>
                  {plan.creditsPerPeriod} scans per{" "}
                  {plan.priceCents === 0 || interval === "month" ? "maand" : "jaar"}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-brand">✓</span>
                  {plan.features.seats !== null
                    ? `${plan.features.seats} betaalde seats`
                    : `Maximaal ${plan.maxMembers} teamleden`}
                </li>
                <li className="flex items-center gap-2">
                  <span className={plan.features.uptime ? "text-brand" : "text-slate-600"}>
                    {plan.features.uptime ? "✓" : "✕"}
                  </span>
                  Uptime monitoring
                </li>
                <li className="flex items-center gap-2">
                  <span className={plan.features.github ? "text-brand" : "text-slate-600"}>
                    {plan.features.github ? "✓" : "✕"}
                  </span>
                  GitHub-reposcans
                </li>
                <li className="flex items-center gap-2">
                  <span className={plan.features.white_label ? "text-brand" : "text-slate-600"}>
                    {plan.features.white_label ? "✓" : "✕"}
                  </span>
                  White-label branding
                </li>
              </ul>

              <div className="mt-8 flex-1" />

              {isCurrent ? (
                <Link
                  href="/billing"
                  className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm font-semibold transition hover:border-slate-500"
                >
                  Huidig plan — beheren
                </Link>
              ) : !signedIn ? (
                <Link
                  href="/register"
                  className={`rounded-lg px-4 py-3 text-center text-sm font-semibold transition ${
                    isFeatured
                      ? "bg-brand text-slate-950 hover:bg-brand/90"
                      : "border border-slate-700 hover:border-slate-500"
                  }`}
                >
                  {plan.id === "free" ? "Start gratis" : "Aanmelden en upgraden"}
                </Link>
              ) : plan.id === "free" ? (
                <Link
                  href="/dashboard"
                  className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm font-semibold transition hover:border-slate-500"
                >
                  Naar dashboard
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => checkout(plan.id)}
                  className="rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
                >
                  {busy === plan.id ? "Bezig…" : `Upgrade naar ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
