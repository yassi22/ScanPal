"use client";

import { useCallback, useEffect, useState } from "react";
import type { InvoiceView, SubscriptionView } from "@scanpal/shared";

const STATUS_LABELS: Record<string, string> = {
  paid: "Betaald",
  open: "Open",
  void: "Vervallen",
  uncollectible: "Oninbaar",
  draft: "Concept",
  past_due: "Achterstallig",
};

type Props = {
  isOwner: boolean;
  isPro: boolean;
  subscription: SubscriptionView;
};

export function BillingManager({ isOwner, isPro, subscription: initial }: Props) {
  const [subscription, setSubscription] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const setBanner = (err: string | null, ok: string | null = null) => {
    setError(err);
    setNotice(ok);
  };

  const refresh = useCallback(async () => {
    const res = await fetch("/api/billing/subscription");
    const data = await res.json().catch(() => null);
    if (res.ok && data?.subscription) setSubscription(data.subscription);
  }, []);

  async function run(action: () => Promise<Response>, success: string) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await action();
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Actie mislukt");
      }
      setBanner(null, success);
      await refresh();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  async function cancelPlan() {
    await run(() => fetch("/api/billing/subscription", { method: "DELETE" }), "Opgezegd — toegang tot einde periode");
  }

  async function reactivatePlan() {
    await run(
      () =>
        fetch("/api/billing/subscription", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reactivate: true }),
        }),
      "Opzegging ongedaan gemaakt",
    );
  }

  async function switchInterval() {
    await run(
      () =>
        fetch("/api/billing/subscription", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interval: subscription.interval === "year" ? "month" : "year",
          }),
        }),
      "Plan-interval gewijzigd",
    );
  }

  const isProActive =
    isPro && (subscription.status === "active" || subscription.status === "trialing");

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
        {isProActive && (
          <div className="flex flex-wrap justify-end gap-2">
            <PortalButton />
            {isOwner && !subscription.cancel_at_period_end && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={switchInterval}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold transition hover:border-slate-500 disabled:opacity-50"
                >
                  {busy ? "Bezig…" : subscription.interval === "year" ? "Naar maandplan" : "Naar jaarplan"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                  className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-400 transition hover:border-red-500/60 disabled:opacity-50"
                >
                  Opzeggen
                </button>
              </>
            )}
            {isOwner && subscription.cancel_at_period_end && (
              <button
                type="button"
                disabled={busy}
                onClick={reactivatePlan}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
              >
                Hervatten
              </button>
            )}
          </div>
        )}
      </div>

      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold">Abonnement opzeggen?</h3>
            <p className="mt-2 text-sm text-slate-400">
              Je houdt toegang tot het einde van de huidige periode
              ({subscription.current_period_end
                ? new Date(subscription.current_period_end).toLocaleDateString("nl-NL")
                : "de lopende periode"}
              ). Daarna worden scans gepauzeerd; je sites en rapporten blijven
              bewaard.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold transition hover:border-slate-500"
              >
                Terug
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={cancelPlan}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
              >
                {busy ? "Bezig…" : "Opzeggen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);

  async function openPortal() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Portal openen mislukt");
      window.location.href = data.url;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Portal openen mislukt");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={openPortal}
      disabled={busy}
      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold transition hover:border-slate-500 disabled:opacity-50"
    >
      {busy ? "Bezig…" : "Abonnement beheren"}
    </button>
  );
}

function formatMoney(cents: number, currency: string): string {
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return currency === "eur" ? `€${value}` : `${value} ${currency.toUpperCase()}`;
}

function Invoices() {
  const [invoices, setInvoices] = useState<InvoiceView[] | null>(null);
  const [noCustomer, setNoCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/invoices")
      .then(async (res) => {
        if (res.status === 404) {
          setNoCustomer(true);
          return null;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Facturen ophalen mislukt");
        }
        return res.json();
      })
      .then((data) => setInvoices(data?.invoices ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Er ging iets mis"));
  }, []);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="font-semibold">Facturen</h2>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {!error && noCustomer && (
        <p className="mt-3 text-sm text-slate-400">
          Nog geen facturen — facturen verschijnen zodra je een betaald plan hebt.
        </p>
      )}
      {!error && !noCustomer && invoices === null && (
        <p className="mt-3 text-sm text-slate-500">Laden…</p>
      )}
      {!error && !noCustomer && invoices !== null && invoices.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">Nog geen facturen.</p>
      )}
      {!error && !noCustomer && invoices !== null && invoices.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="pb-2 pr-4 font-medium">Nummer</th>
                <th className="pb-2 pr-4 font-medium">Datum</th>
                <th className="pb-2 pr-4 font-medium">Bedrag</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Download</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-slate-800/60">
                  <td className="py-2.5 pr-4 text-slate-300">{invoice.number}</td>
                  <td className="py-2.5 pr-4 text-slate-400">
                    {new Date(invoice.created_at).toLocaleDateString("nl-NL")}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-300">
                    {formatMoney(invoice.total, invoice.currency)}
                    {invoice.tax_total > 0 && (
                      <span className="ml-1 text-xs text-slate-500">
                        (incl. btw {formatMoney(invoice.tax_total, invoice.currency)})
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        invoice.status === "paid"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : invoice.status === "open" || invoice.status === "past_due"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-slate-500/10 text-slate-400"
                      }`}
                    >
                      {STATUS_LABELS[invoice.status] ?? invoice.status}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {invoice.pdf_url ? (
                      <a
                        href={invoice.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand transition hover:text-brand/80"
                      >
                        PDF
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

BillingManager.PortalButton = PortalButton;
BillingManager.Invoices = Invoices;
