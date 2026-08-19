"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceView, SubscriptionView } from "@scanpal/shared";
import { useAccessibleDialog } from "@/lib/use-accessible-dialog";
import {
  ArrowSquareOut,
  CheckCircle,
  FilePdf,
  Receipt,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  open: "Open",
  void: "Void",
  uncollectible: "Uncollectible",
  draft: "Draft",
  past_due: "Past due",
};

type Props = {
  isOwner: boolean;
  isPaid: boolean;
  subscription: SubscriptionView;
};

export function BillingManager({ isOwner, isPaid, subscription: initial }: Props) {
  const router = useRouter();
  const [subscription, setSubscription] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelDialogRef = useAccessibleDialog(
    confirmCancel,
    () => setConfirmCancel(false),
  );

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
      router.refresh();
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

  const isPaidActive =
    isPaid && (subscription.status === "active" || subscription.status === "trialing");

  return (
    <>
      <div className="billing-manager-actions">
        {error && <p className="billing-inline-message is-error"><WarningCircle size={15} aria-hidden="true" /> {error}</p>}
        {notice && <p className="billing-inline-message is-success"><CheckCircle size={15} aria-hidden="true" /> {notice}</p>}
        {isPaidActive && isOwner && (
          <div>
            <PortalButton />
            {!subscription.cancel_at_period_end && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={switchInterval}
                  className="billing-secondary-action"
                >
                  {busy ? "Updating…" : subscription.interval === "year" ? "Switch to monthly" : "Switch to yearly"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                  className="billing-danger-action"
                >
                  Cancel plan
                </button>
              </>
            )}
            {subscription.cancel_at_period_end && (
              <button
                type="button"
                disabled={busy}
                onClick={reactivatePlan}
                className="billing-primary-action"
              >
                Reactivate
              </button>
            )}
          </div>
        )}
      </div>

      {confirmCancel && (
        <div className="workspace-modal-backdrop" role="presentation">
          <div ref={cancelDialogRef} tabIndex={-1} className="workspace-modal billing-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-plan-title">
            <button type="button" className="workspace-modal-close" onClick={() => setConfirmCancel(false)} aria-label="Close"><X size={18} aria-hidden="true" /></button>
            <span className="workspace-modal-icon is-warning"><WarningCircle size={22} aria-hidden="true" /></span>
            <h2 id="cancel-plan-title">Cancel this subscription?</h2>
            <p>
              Access remains available until the end of the current period
              ({subscription.current_period_end
                ? new Date(subscription.current_period_end).toLocaleDateString("nl-NL")
                : "the current billing period"}
              ). New scans pause afterward; properties and reports stay stored.
            </p>
            <div>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="dashboard-light-button"
              >
                Keep plan
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={cancelPlan}
                className="billing-confirm-cancel"
              >
                {busy ? "Canceling…" : "Cancel subscription"}
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
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Portal openen mislukt");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the billing portal");
      setBusy(false);
    }
  }

  return (
    <span className="billing-portal-control">
      <button type="button" onClick={openPortal} disabled={busy} className="billing-secondary-action">
        {busy ? "Opening…" : "Manage subscription"}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

function formatMoney(cents: number, currency: string): string {
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return currency === "eur" ? `€${value}` : `${value} ${currency.toUpperCase()}`;
}

export function BillingInvoices() {
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
    <section className="billing-invoice-ledger">
      <div className="workspace-section-heading"><div><h2>Invoices</h2><p>Receipts and payment status from the billing account.</p></div><span><Receipt size={18} aria-hidden="true" /></span></div>
      {error && <p className="workspace-alert is-error" role="alert"><WarningCircle size={16} aria-hidden="true" /> {error}</p>}
      {!error && noCustomer && (
        <div className="billing-invoice-empty">Invoices appear here after the first paid billing period.</div>
      )}
      {!error && !noCustomer && invoices === null && (
        <div className="billing-invoice-loading" role="status"><span /><span /><span /></div>
      )}
      {!error && !noCustomer && invoices !== null && invoices.length === 0 && (
        <div className="billing-invoice-empty">No invoices have been issued yet.</div>
      )}
      {!error && !noCustomer && invoices !== null && invoices.length > 0 && (
        <div className="billing-invoice-list">
          {invoices.map((invoice) => (
            <article key={invoice.id} className="billing-invoice-row">
              <span className="billing-invoice-icon"><FilePdf size={19} aria-hidden="true" /></span>
              <div><strong>{invoice.number}</strong><small>{new Date(invoice.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></div>
              <div className="billing-invoice-amount"><strong>{formatMoney(invoice.total, invoice.currency)}</strong>{invoice.tax_total > 0 && <small>Includes {formatMoney(invoice.tax_total, invoice.currency)} tax</small>}</div>
              <span className={`billing-invoice-status is-${invoice.status}`}>{STATUS_LABELS[invoice.status] ?? invoice.status}</span>
              {invoice.pdf_url ? (
                <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer" aria-label={`Open invoice ${invoice.number}`}><ArrowSquareOut size={17} aria-hidden="true" /><span>Open PDF</span></a>
              ) : <span className="billing-invoice-unavailable">Unavailable</span>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
