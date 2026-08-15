# Plan: Pricing + Stripe + credits

**Doel**: Publieke pricing-pagina, Stripe checkout, credit-limieten per plan (scans).

## DB (migratie in `packages/db`)

- Nieuwe tabel `subscriptions`: `team_id` (unique), `stripe_customer_id`, `stripe_subscription_id`, `plan` (`free`|`pro`), `status`, `current_period_end`, `credits_used`, `credits_reset_at`
- Nieuwe tabel `credit_transactions` (audit): `team_id`, `amount`, `reason`, `scan_id`, `created_at`

## Plancatalogus (`packages/shared`)

- `free`: 5 scans/mnd, geen uptime, geen GitHub scans
- `pro`: 500 scans/mnd, uptime + GitHub scans inbegrepen
- Zod schema + prijs/credits in één bron van waarheid

## API routes (`apps/web/app/api/`)

| Route | Methode | Beschrijving |
|---|---|---|
| `/api/plans` | GET | Publiek, pricing-kaarten |
| `/api/billing/checkout` | POST | Stripe Checkout Session (success/cancel URL) |
| `/api/billing/portal` | POST | Stripe Billing Portal (abonnement beheren) |
| `/api/webhooks/stripe` | POST | Signature-verificatie + idempotency |
| `/api/billing/usage` | GET | Credits verbruik (usage-balk) |

## Webhook handling

- `checkout.session.completed` → `subscriptions` rij aanmaken/updaten, plan activeren
- `customer.subscription.updated` / `.deleted` → status syncen (`trialing`/`active`/`past_due`/`canceled`)
- Idempotent via Stripe `Idempotency-Key`/event-id; credits reset bij nieuwe periode

## Credit-afdwinging

- In `POST /api/scans`: atomisch `UPDATE subscriptions SET credits_used = credits_used + 1 WHERE credits_used < plan_limit RETURNING ...`
- Bij limiet → `402 Payment Required` + `upsell` payload
- Feature-gating (uptime, GitHub) via plancatalogus
- Redis lock per team tegen race bij gelijktijdige scans

## UI

- Publieke pricing-pagina (3 kaarten, CTA → checkout)
- Billing-pagina (dashboard): huidig plan, usage-balk, portal-knop, status
- `402`-handling: modaal met upsell-CTA
- Gated functies verborgen/gelabeld "Pro" voor free-users

## Stappen

1. Migratie + plancatalogus in `packages/shared`
2. `lib/billing.ts` (Stripe client, helpers)
3. Pricing-pagina (publiek)
4. Checkout + portal routes
5. Webhook handler met signature-verificatie + idempotency
6. Credit-enforcement in `POST /api/scans` + feature-gating
7. Billing-UI + `402`-upsell modaal
8. Tests: webhook flows, credit-exhaustie, atomic decrement onder concurrency

## Open vragen

- Proefperiode (trial) ja/nee
- Credit-rollover of per-maand reset
- Stripe testmode keys in dev (Stripe CLI `stripe listen`)

## Acceptatiecriteria

- [ ] Pricing-pagina toont plan-kaarten, checkout start
- [ ] Betaling via webhook activeert abonnement; annulering synct status
- [ ] Credits atoom afgeboekt; bij limiet `402` + upsell-UI
- [ ] Free-plan kan geen uptime/GitHub scans starten
- [ ] Usage-balk toont verbruik in huidige periode
