import { pool } from "@/lib/db";
import { getDashboardContext } from "@/lib/dashboard-context";
import { getTeamUsage } from "@/lib/credits";
import { getSubscriptionView } from "@/lib/billing";
import { plans, isPaidPlan } from "@scanpal/shared";
import {
  BillingInvoices,
  BillingManager,
  PortalButton,
} from "@/components/billing-manager";
import {
  CalendarBlank,
  CheckCircle,
  CreditCard,
  Gauge,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
};

export default async function BillingPage() {
  const result = await getDashboardContext();

  const [usage, subscription] = await Promise.all([
    getTeamUsage(pool, result.team.id),
    getSubscriptionView(pool, result.team.id),
  ]);
  const plan = plans[usage.plan.id];
  const isPaid = isPaidPlan(plan.id);
  const isOwner = result.membership.role === "owner";
  const usedPct = usage.creditsLimit > 0
    ? Math.min(100, Math.round((usage.creditsUsed / usage.creditsLimit) * 100))
    : 100;
  const intervalLabel = subscription.interval === "year" ? "year" : "month";
  const periodDate = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const planDescription = plan.id === "max"
    ? `${plan.creditsPerPeriod} scans per ${intervalLabel} · ${plan.features.seats ?? plan.maxMembers} paid seats · white-label reports`
    : isPaid
      ? `${plan.creditsPerPeriod} scans per ${intervalLabel} · ${plan.maxMembers} team members · uptime and GitHub scanning`
      : `${plan.creditsPerPeriod} scans per month · ${plan.maxMembers} team members`;

  return (
    <div className="dashboard-home billing-page" data-design-direction="luminous-technical-calm">
      <header className="dashboard-page-heading billing-page-heading">
        <div><h1>Plan, usage, and payment in one place.</h1><p>Keep the subscription for <strong>{result.team.name}</strong> predictable and auditable.</p></div>
        <span className="dashboard-plan-chip">{plan.name} plan</span>
      </header>

      <section className="billing-cockpit">
        <div className="billing-plan-header">
          <div className="billing-plan-title"><span><CreditCard size={21} aria-hidden="true" /></span><div><div><h2>{plan.name}</h2><span className={`billing-status is-${subscription.status}`}>{STATUS_LABELS[subscription.status] ?? subscription.status}</span></div><p>{planDescription}</p></div></div>
          <BillingManager isOwner={isOwner} isPaid={isPaid} subscription={subscription} />
        </div>

        <div className="billing-usage-panel">
          <div className="billing-usage-heading"><span><Gauge size={19} aria-hidden="true" /></span><div><h3>Scan allowance</h3><p>{usage.resetAt ? `Resets ${new Date(usage.resetAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Resets monthly"}</p></div><strong>{usage.creditsUsed} <span>/ {usage.creditsLimit}</span></strong></div>
          <div className="billing-usage-track" role="progressbar" aria-label="Scan allowance used" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100}><span className={usedPct >= 100 ? "is-danger" : usedPct >= 80 ? "is-warning" : undefined} style={{ width: `${usedPct}%` }} /></div>
          <p>{usedPct}% of this period&apos;s allowance has been used.</p>
        </div>

        <div className="billing-detail-grid">
          <div><CalendarBlank size={18} aria-hidden="true" /><span>{subscription.cancel_at_period_end ? "Access ends" : "Next renewal"}</span><strong>{periodDate ?? `Billed per ${intervalLabel}`}</strong></div>
          <div><CreditCard size={18} aria-hidden="true" /><span>Payment method</span><strong>{subscription.default_payment_method ? `${subscription.default_payment_method.brand} ···· ${subscription.default_payment_method.last4}` : "No saved method"}</strong></div>
          <div><CheckCircle size={18} aria-hidden="true" /><span>Billing owner</span><strong>{isOwner ? "You can manage billing" : "Owner-managed"}</strong></div>
        </div>

        {subscription.status === "past_due" && (
          <div className="billing-payment-alert"><WarningCircle size={19} aria-hidden="true" /><p>Payment is past due, so new scans are paused. {isOwner ? "Update the payment method to continue." : "Ask the billing owner to update the payment method."}</p>{isOwner && <PortalButton />}</div>
        )}
      </section>

      <div className="billing-invoices-section"><BillingInvoices /></div>

      <footer className="dashboard-page-footer"><span>Billing actions remain owner-controlled.</span><span>ScanPal · Billing</span></footer>
    </div>
  );
}
