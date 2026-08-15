# Plan: Pricing + Stripe + credits (plan-beperkingen)

**Doel**: Publieke pricing-pagina, Stripe Checkout, credit-limieten per plan (scans/maand).

**Status**: Nog niet gestart.

## Uitgangssituatie (code vandaag)

- Er is nog geen `POST /api/scans`; scans ontstaan nu alleen via `POST /api/onboarding/sites` (inline modus, `scanMode === "inline"`)
- Credit-afdwinging moet dus in een **gedeelde helper** komen die óók door de toekomstige `POST /api/scans` (BullMQ-pipeline) wordt gebruikt
- Teams bestaan al; credits horen bij `team_id`

## Plancatalogus (`packages/shared/src/plans.ts`, nieuw — single source of truth)

```ts
export const plans = {
  free: { id: "free", name: "Free", creditsPerPeriod: 5, maxMembers: 3,
          features: { uptime: false, github: false } },
  pro:  { id: "pro",  name: "Pro",  creditsPerPeriod: 500, maxMembers: 10,
          features: { uptime: true, github: true } },
} as const;
// + zod schema, Stripe Price ID per plan, prijs in centen (€0, €29/mnd)
```

## DB (migratie `003_billing.sql` in `packages/db`)

- `subscriptions`: `team_id` (unique FK), `stripe_customer_id`, `stripe_subscription_id`,
  `plan` (`free`|`pro`), `status` (`active`|`trialing`|`past_due`|`canceled`),
  `current_period_end`, `credits_used` (int, default 0), `created_at`, `updated_at`
- `credit_transactions` (audit): `id`, `team_id`, `amount` (+/-), `reason`, `scan_id`, `created_at`
- `webhook_events`: `stripe_event_id` (unique) — idempotentie

Free-plan = geen rij in `subscriptions`? Nee: **altijd** een rij (free is ook een plan),
zodat `credits_used` een uniform check-punt heeft. Bij check-out upsert.

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/plans` | GET | publiek | Pricing-kaarten uit catalogus |
| `/api/billing/checkout` | POST | ingelogd | Stripe Checkout Session (success/cancel URL, metadata `team_id`) |
| `/api/billing/portal` | POST | ingelogd | Stripe Billing Portal (abonnement beheren) |
| `/api/billing/usage` | GET | ingelogd | Verbruik huidige periode (usage-balk) |
| `/api/webhooks/stripe` | POST | webhook | Signature-verificatie + idempotente verwerking |

## `lib/billing.ts` + `lib/credits.ts` (nieuw)

- `billing.ts`: Stripe client (`stripe` SDK), `createCheckoutSession(team)`, `createPortalSession(team)`, `constructWebhookEvent(req)` (raw body + signature), helpers om plan/status te syncen
- `credits.ts` — **atoom afboeken** (core):
  ```sql
  update subscriptions
     set credits_used = credits_used + 1
   where team_id = $1 and credits_used < $2
  returning credits_used
  ```
  → 0 rijen = limiet bereikt → `402 Payment Required` + `{ error, upsell: { plan: "pro" } }`
  - Lazy period-reset: als `current_period_end < now()` → eerst resetten (`credits_used = 0`)
  - Elke boeking → `credit_transactions` insert + `credit_used` event
  - Opgeroepen vanuit `POST /api/onboarding/sites` én de toekomstige `POST /api/scans`

## Webhook handling (idempotent)

- `checkout.session.completed` → upsert `subscriptions` (plan uit metadata/line items), status `active`
- `customer.subscription.updated` / `.deleted` → status syncen, `current_period_end` updaten
- Signature-verificatie: `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`
- Idempotentie: eerst checken in `webhook_events` (event-id unique), daarna insert in dezelfde transactie
- Bij plan-downgrade: `credits_used` mag boven nieuw limiet staan; scans worden pas geblokkeerd bij de volgende scan (geen data-verlies)

## Credit-afdwinging & feature-gating

- **Scan-limiet**: helper in `lib/credits.ts` (hierboven) → `402` + upsell-payload
- **Feature-gating** (uptime, GitHub-scans): catalogus `features`-vlaggen checken vóór enqueue; UI verbergt/labelt functies "Pro"
- **Member-limiet**: `maxMembers` uit catalogus in Feature 2 invite-flow
- Race-condition: de atomic `UPDATE ... WHERE credits_used < limit` volstaat — geen Redis-lock nodig (DB is het wachtpunt)

## UI

- Publieke `/pricing` pagina: plan-kaarten (Free/Pro), prijzen, feature-lijst, CTA → checkout
- `(dashboard)/billing`: huidig plan, status, usage-balk (verbruik/limiet, reset-datum), portal-knop, factuurhistorie (optioneel)
- `402`-handling: modaal "Scan-limiet bereikt" met upgrade-CTA → checkout
- Gated functies gelabeld "Pro" / verborgen voor free-users

## Config

- `.env`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`
- Dev: Stripe CLI `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (testmode keys)

## Stappen

1. Migratie `003_billing.sql` + plancatalogus in `packages/shared`
2. `lib/billing.ts` (Stripe client, checkout/portal helpers)
3. Publieke `/pricing` pagina
4. Checkout + portal routes (test met testmode)
5. Webhook route: signature-verificatie + idempotentie
6. `lib/credits.ts` + koppeling in `POST /api/onboarding/sites` (en toekomstige `POST /api/scans`)
7. Billing-UI (dashboard) + `402`-upsell modaal
8. Tests: webhook flows, credit-exhaustie (402), atomic decrement onder concurrency, period-reset, downgrade

## Open vragen

- Trial (bijv. 14 dagen Pro) — extra Stripe checkout mode of later?
- Credit-rollover of per-maand reset? (standaard: reset)
- Prijzen/limieten definitief: Free 5 scans & 3 leden · Pro €29/mnd, 500 scans & 10 leden?
- Stripe Price ID's: aanmaken in dashboard of via API in seed-script?

## Acceptatiecriteria

- [ ] Pricing-pagina toont plan-kaarten; checkout start en verwerkt betaling
- [ ] Webhook activeert abonnement; annulering/upgrade synct status
- [ ] Credits atoom afgeboekt; bij limiet `402` + upsell-modaal
- [ ] Free-plan kan geen uptime/GitHub-scans starten; ledenlimiet geldt in invite-flow
- [ ] Usage-balk toont verbruik en reset-moment in huidige periode
- [ ] Webhook-idempotent: dubbele events geven geen dubbele boeking
