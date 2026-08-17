# Plan: Facturen/abonnement-beheer (billing-admin)

**Doel**: Feature 16 — teams beheren hun abonnement en facturen vanuit de app: abonnementsstatus en -periode, plan wijzigen, opzeggen/hervatten, betaalmethode, en facturenlijst met PDF-download. Bewust beperkt tot wat plan 03 (checkout/credits) en feature 22 (webhook plan-sync) niet al dekken.

**Status**: ✅ klaar (2026-08-16)

## Besluiten (bevestigd 2026-08-16)

1. **Factuurbron = live uit de Stripe API** (geen lokale `invoices`-tabel). `GET /api/billing/invoices` roept `stripe.invoices.list({ customer })` aan; download via de Stripe-gehoste PDF (`invoice_pdf`). Stripe blijft single source of truth — geen extra webhook-events, geen sync-stale data. Nadeel (een API-call per pagina-load) weegt niet op tegen sync-complexiteit.
2. **Abonnementsacties in-app**: plan wijzigen en opzeggen/hervatten via `stripe.subscriptions.*`; betaalmethode en factuurgegevens blijven in het Stripe Billing Portal (hosted, al aanwezig via plan 03).
3. **Opzeggen = `cancel_at_period_end`** (toegang tot einde periode), daarna automatische status `canceled` via webhook; data (sites/scans/reports) blijft behouden, feature-gating per plan 03 (geen scans meer, uptime/GitHub uit). Herstarten = `cancel_at_period_end = false` (reactivate) — geen nieuwe checkout nodig als de betaalmethode geldig is.
4. **`cancel_at_period_end` en `interval` syncen mee in de webhook** (`customer.subscription.updated` draagt beide velden) → nieuwe kolommen op `subscriptions`, zodat de UI (banner "stopt op …", "per maand/jaar") geen live Stripe-call per render nodig heeft.
5. **Jaarplan erbij**: tweede Stripe price (Pro annual) + `STRIPE_PRICE_PRO_ANNUAL`-env. Checkout krijgt `{ interval: "month" | "year" }`; `resolvePlanFromPrice` mapt beide price-id's → `pro`. Korting jaarbedrag: open vraag (voorstel 2 maanden gratis → €290/jaar). De pricing-pagina krijgt een maand/jaar-toggle.
6. **Stripe Tax aan** (v1): `automatic_tax: { enabled: true }` op checkout, `tax_behavior: "exclusive"` op de prices (stripe-node 22 kent geen per-item `tax_behavior` bij price-refs — configuratie in het Stripe-dashboard), belastingregisters NL/EU. Prijzen op de pricing-pagina exclusief btw met notitie "btw wordt toegevoegd". Factuurbedragen in de UI = wat Stripe retourneert (incl. btw).
7. **Betalingsfout → hub-notificatie `payment_failed`** (plan 13, default **aan**): in-app + Resend-mail bij `invoice.payment_failed`, `dedup_key` per invoice-id (Stripe dunning-retries leveren dus maximaal 1 melding per factuur). Stripe's eigen dunning blijft actief; status `past_due` → credits bevriezen (bestaat al in `credits.ts`).
8. **Factuur-e-mails**: Stripe's eigen receipts (default aan) — geen eigen Resend-factuur-mail; branding komt later met feature 64 (white-label).
9. Migratie **`012_billing_admin.sql`** (011 is geclaimd door plan 15).

## Uitgangssituatie (code vandaag)

- Plan 03 grotendeels geïmplementeerd: `/pricing`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `GET /api/billing/usage`, `lib/billing.ts` (Stripe client + helpers, `env.stripePricePro`), `lib/credits.ts` (atomic spend + `ACTIVE_STATUSES`-gating), billing-pagina met plan/usage-balk + portal-knop.
- Feature 22-code bestaat al: `app/api/webhooks/stripe/route.ts` + `lib/billing-core.ts` (`processStripeEvent`, checkout + subscription events, idempotentie via `webhook_events`) + `resolvePlanFromPrice`.
- `subscriptions`-tabel (migratie 003): plan/status/`current_period_end`/`credits_used`/stripe id's. Geen `cancel_at_period_end`, geen `interval`, geen facturen-opslag. Plancatalogus in `packages/shared/src/plans.ts` kent alleen maandprijs (`priceCents: 2900`).
- Nog niet: facturenlijst, in-app opzeggen/hervatten, jaarplan, Stripe Tax, `payment_failed`-notificatie, betaalmethode-weergave.

## Contract / DB / API

**Migratie 012** (in `packages/db`):
- `alter table subscriptions add column cancel_at_period_end boolean not null default false;`
- `alter table subscriptions add column interval text not null default 'month' check (interval in ('month', 'year'));`
- Geen `invoices`-tabel (live fetch).

**packages/shared** (nieuw `billing.ts`):
- `invoiceViewSchema`: `{ id, number, status (paid|open|void|uncollectible|draft), created_at, subtotal, tax_total, total (centen), currency, period_start/end, pdf_url, hosted_url }` — gepingd van de Stripe-invoice, zonder gevoelige data.
- `subscriptionViewSchema`: `{ plan, status, current_period_end, cancel_at_period_end, interval (month|year), default_payment_method: { brand, last4, exp_month, exp_year } | null }`.
- `billingCheckoutSchema`: `{ interval: z.enum(["month", "year"]) }`.
- `notifications.ts`: type `payment_failed` toevoegen (default enabled, template "Betalingsfout").
- `plans.ts`: geen wijziging van het prijsmodel (één pro-plan); price-id's per interval blijven in env, zoals `stripePricePro` vandaag.
- `billing-core.ts` (bestaand bestand): bij `handleSubscriptionEvent` ook `cancel_at_period_end` + `interval` syncen (via price-id → maand/jaar); `SUPPORTED_TYPES` + `invoice.payment_failed` (retourneert "processed", zodat de route kan notificeren).

**`lib/billing.ts`-uitbreidingen**:
- `createCheckoutSession(input, { interval })` → price `env.stripePricePro` of `env.stripePriceProAnnual`; `automatic_tax.enabled = true`, `line_items[].tax_behavior = "exclusive"`, `customer_update.address = "auto"` (Stripe Tax heeft een klantadres nodig; bij nieuwe klant via `customer_creation: "always"` + `customer_email`).
- `listInvoices(customerId)`, `getStripeSubscription(subId)`, `cancelSubscription(subId)` (`cancel_at_period_end = true`), `reactivateSubscription(subId)`.
- `resolvePlanFromPrice`: ook `env.stripePriceProAnnual` → `pro`.

**API-routes** (`apps/web`):

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/billing/invoices` | GET | teamlid | facturenlijst (live Stripe, `customer` uit `subscriptions`), desc, max 12 maanden terug |
| `/api/billing/subscription` | GET | teamlid | abonnement-view (DB + betaalmethode live) |
| `/api/billing/subscription` | PATCH | owner | reactivate (`cancel_at_period_end = false`); plan-wissel maand↔jaar via items-price |
| `/api/billing/subscription` | DELETE | owner | opzeggen (`cancel_at_period_end = true`) |
| `/api/billing/checkout` | POST | ingelogd | bestaande route; body `{ interval }` (default `month`) |

Authz: GET teamlid (via membership-join), mutaties owner-only (parallel aan plan 02/14/15). Geen `stripe_customer_id` → 404 (consistent met site-scoping, geen data-lek).

**UI** (`(dashboard)/billing/page.tsx` en `/pricing` uitbreiden):
- Abonnement-card: plan + status + periode ("verlengt op … · per maand/jaar"), betaalmethode (merk + laatste 4), knop "Abonnement beheren" (portal).
- Opzeggen: modal met bevestiging + gevolgen (toegang tot einde periode, daarna geen nieuwe scans) → DELETE → banner "Stopt op …" + knop "Hervatten".
- `past_due`: amber-waarschuwing "Betalingsachterstand — scans gepauzeerd" + knop naar portal (betaalmethode updaten).
- Facturen-card: tabel (nr, datum, bedrag incl. btw, status, download-icoon → `pdf_url`), lege state voor free/customer-loos.
- Pricing-pagina: toggle maand/jaar (jaar met korting-label), prijzen excl. btw + notitie.

## Stappen

1. Migratie 012 + db-types + `packages/shared/billing.ts`-schema's + `payment_failed`-type + tests
2. `billing-core.ts`: `cancel_at_period_end`/`interval`-sync in subscription-webhook + `invoice.payment_failed`-afhandeling + tests
3. `lib/billing.ts`: checkout-interval + Stripe Tax-params, `listInvoices`, `getStripeSubscription`, `cancelSubscription`, `reactivateSubscription`, `resolvePlanFromPrice`-uitbreiding + tests
4. API-routes + tests (authz teamlid vs owner, geen-customer → 404, lege facturenlijst, interval-validatie)
5. UI: billing-pagina (opzegmodal, hervatten, facturen-tabel, past_due-banner, betaalmethode, interval-weergave) + pricing-toggle
6. `payment_failed`-notificatie via de hub (plan 13) bij `invoice.payment_failed`-webhook
7. Env: `STRIPE_PRICE_PRO_ANNUAL` toevoegen aan `.env`/`.env.example` + `lib/env.ts`; Stripe-config (price, Tax-registers)
8. FEATURES.md (16 → 16-billing-admin, 📝) + ROADMAP.md plan-overzicht bijwerken

## Open vragen (beantwoord 2026-08-16)

- ~~Jaarkorting: voorstel 2 maanden gratis (€290/jaar i.p.v. €348) — definitief bedrag?~~ → **€290/jaar** (`annualPriceCents: 29000` op het pro-plan, display-only; de echte prijs is de Stripe-price).
- ~~Betaalmethode-weergave: opslaan in DB via webhook (`payment_method`-event) of live ophalen bij `GET /api/billing/subscription`? (voorstel: live, 1 call op pagina-load)~~ → **Live ophalen** (1 call op pagina-load, met DB-fallback bij Stripe-fouten).
- ~~Factuur-detailpagina per factuur (los van de lijst + PDF) nodig of niet? (voorstel: niet in v1)~~ → **Niet in v1** (lijst + PDF-download volstaat; hosted_url als alternatief).
- ~~Stripe Tax: `exclusive` (btw bovenop) bevestigd; welke registers (alleen NL/EU?) en tarieven configureren we in Stripe?~~ → **Exclusive bevestigd**; `tax_behavior` wordt op de price zelf gezet (stripe-node 22 heeft geen per-item tax_behavior bij price-refs); registers NL/EU handmatig in het Stripe-dashboard (deploy-stap).

## Acceptatiecriteria

- [x] Billing-pagina toont abonnement (plan, status, periode, interval, betaalmethode) zonder Stripe-call per render (DB + hooguit 1 live call)
- [x] Opzeggen met bevestiging → `cancel_at_period_end`-banner "Stopt op …"; hervatten ongedaan maken; beide owner-only
- [x] Checkout accepteert maand/jaar; jaar-abonnement syncet `interval` en plan correct via webhook
- [x] Facturenlijst met nummer, datum, bedrag incl. btw, status en werkende PDF-download; lege state zonder customer
- [x] Stripe Tax: facturen bevatten btw-splitsing; prijzen op pricing-pagina excl. btw met notitie
- [x] `past_due` → waarschuwing + portal-knop; scans geblokkeerd (bestaande credits-logica)
- [x] `invoice.payment_failed` levert maximaal 1 notificatie (in-app + mail) per invoice (dedup)
- [x] Webhook-sync: `cancel_at_period_end`/`interval`/status correct na cancel/updated-events (idempotent)
- [x] Tests, lint en typecheck groen; FEATURES.md + ROADMAP bijgewerkt
