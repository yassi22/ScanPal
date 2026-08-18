# Phase-2 Billing Discovery Spec — Task `phase-2-billing-discovery-6e0b`

**Status: COMPLETE (read-only discovery; construction-ready spec below)**
**Date:** 2026-08-18
**Plan:** 64-team-seats-white-label (step 2)
**Task:** Wire the `max` plan through the ENTIRE billing path + invite seat-limit change (HTTP 409 + upsell payload, limit source `features.seats ?? maxMembers`)

---

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Discovery Worker — `phase-2-billing-discovery-6e0b` |
| Status | COMPLETE |
| Changed paths | none (read-only run; only spec + report + one MFL entry written) |
| Criteria summary | Q1 plans data flow, Q2 invite contract, Q3 test seams, Q4 downgrade/upgrade semantics — all answered with citations below |
| Verification summary | Full reads of plans.ts, billing.ts, billing-core.ts, env.ts, checkout/subscription/invoices/usage/plans routes, Stripe webhook route, invites-core.ts + both invite routes, credits/invites/billing/billing-core/billing-routes tests, pricing-cards, billing page, pricing page, team-settings, threats routes/pages, schedule route, migrations 003/012/026, db index.ts, scheduler credits.ts. Greps: `planIdSchema\|maxMembers\|resolvePlanFromPrice\|stripePricePro\|assertPlanFeature\|feature\.seats\|white_label\|seats`, `member_limit\|upsell`, `plan\.features\|features\.seats\|white_label`, `plan\.id\|isPro\|=== "pro"`, `planList\|publicPlanSchema\|usageSchema`, `STRIPE_PRICE_PRO`. Phase-1 audit + MFL 001-007 read and cross-checked. |
| Scope / preservation | `packages/shared/src/plans.ts` NOT modified (read-only for this task); the implementer WILL edit it. Pre-existing uncommitted baseline (incl. migration 026, shared branding/workspaces/report-tokens schemas) preserved and treated as accepted. |
| Major-log ids | MFL-20260818-001 (seat limit exists; 400→409+upsell), MFL-003 (seats decisions), MFL-005 (planIdSchema lacks 'max' — ordering constraint), **MFL-20260818-008 (NEW: 8 paid-plan identity gates must broaden)** |
| Unresolved risks / blockers | (1) upsell `next-plan` mapping for member_limit: free→"pro" is obvious; pro(10)/max(3) have no higher member tier (max seats=3 < pro maxMembers=10 per MFL-003) → orchestrator must decide whether pro→max member-limit upsell exists at all. (2) `handleCheckoutCompleted` currently hardcodes plan "pro"; legacy Stripe events without `metadata.plan_id` need a default (recommend "pro"). (3) Accept-route (`invitations/[token]/accept`) also throws member_limit → today 400; decide whether it becomes 409 (no upsell for a non-owner accepter). (4) `planIdSchema`/`plans` record must land before anything can write a `'max'` row (MFL-005). |
| Evidence paths | All cited `file:line` below; phase-1 audit `…/phases/phase-1/current-state-audit.md`; MFL log `…/major-findings-and-fixes.md`. |
| FAST-PATH ELIGIBLE | **NO** — the plan-identity gate broadening (MFL-008) and the open upsell next-plan decision make this a multi-file, decision-dependent change, not a mechanical fast path. |

---

## 1. Facts (verified with citations)

### 1.1 Plans/pricing data flow

- `packages/shared/src/plans.ts`:
  - `planIdSchema = z.enum(["free","pro"])` (:3); `PlanId` (:4).
  - `Plan` type: `{ id, name, priceCents, annualPriceCents?, creditsPerPeriod, maxMembers, apiRatePerMinute, maxWebhooks, features }` (:14-35); `features = { uptime, github, activeTests, onDeploy }` (all `boolean`, :27-34). **No `seats`, no `white_label`.**
  - `plans: Record<PlanId, Plan>` (:37-59): free (maxMembers 3, credits 5, features all false), pro (maxMembers 10, credits 500, features all true).
  - `planList = [plans.free, plans.pro]` (:61). **No `max`.**
  - `publicPlanSchema` (:63-78) mirrors the shape (planId, name, priceCents, annualPriceCents?, creditsPerPeriod, maxMembers, apiRatePerMinute, maxWebhooks, features). `usageSchema` (:94-102) wraps `publicPlanSchema`.
  - `subscriptionSchema` (:81-92) uses `planIdSchema` at :85 — updates automatically once planIdSchema gains "max".
- Consumers of the `plans` record / planList:
  - `apps/web/lib/invites-core.ts:3,71` — `plans[planId].maxMembers` (seat limit).
  - `packages/scan-core/src/credits.ts:2,43,65,83` — `plans[planId].creditsPerPeriod`, `plans[state?.plan ?? "free"]`.
  - `apps/scheduler/src/credits.ts:2,48` — `plans[planId].creditsPerPeriod` (independent copy; comment says temporary duplicate, :24-29).
  - `apps/web/app/pricing/page.tsx:2,63` — `planList` → `PricingCards`.
  - `apps/web/app/api/plans/route.ts:2,8` — `planList.map(publicPlanSchema.parse)` → `{ plans }`.
  - `apps/web/app/(dashboard)/billing/page.tsx:6,34` — `plans[usage.plan.id]`.
  - `apps/web/components/pricing-cards.tsx:5,128` — `plan.maxMembers`, `plan.features.uptime/github`.
  - `apps/web/lib/billing.ts:7` — `PlanId` type only.
  - `packages/shared/src/billing.ts:2,10,49` — `planIdSchema` for `billingCheckoutSchema.planId` (:10) and `subscriptionViewSchema.plan` (:49).
  - MCP server, worker, scheduler otherwise import only other shared modules (grep of `from "@scanpal/shared"`); no other `plans` record consumers found.

### 1.2 Stripe price ↔ plan resolution (end-to-end)

1. **Env**: `apps/web/lib/env.ts:15-20` defines `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_ANNUAL` (all `.optional()`), exposed as `env.stripePricePro`/`stripePriceProAnnual` (:51-52). `.env.example:69-75` documents them.
2. **Checkout (plan → price)**: `apps/web/lib/billing.ts`
   - `createCheckoutSession(input: {teamId, teamName, email, planId, customerId}, interval)` (:39-76) picks `price = interval === "year" ? env.stripePriceProAnnual : env.stripePricePro` (:44) — **ignores `input.planId`**. Sets `metadata: {team_id, plan_id, interval}` on session + subscription_data (:58-61).
   - `switchSubscriptionInterval(subscriptionId, interval)` (:260-275) picks the same two prices (:265) — also plan-unaware.
   - `resolvePlanFromPrice(priceId): PlanId | null` (:24-29) maps pro-month/pro-year → "pro"; everything else → null. **This is the single price→plan function.**
3. **Route**: `apps/web/app/api/billing/checkout/route.ts` — validates `billingCheckoutSchema` (shared :9-12, `planId: planIdSchema`), rejects `planId === "free"` (:22-27), calls `createCheckoutSession(..., parsed.data.interval)`.
4. **Webhook (price → plan, and plan-sync)**: `apps/web/lib/billing-core.ts`
   - `processStripeEvent(db, event, resolvePlanFromPrice)` (:55-98): dedupes via `webhook_events` (:68-77), routes checkout/subscription/invoice events.
   - `handleCheckoutCompleted` (:100-127): reads `metadata.team_id` + `metadata.subscription`; **hardcodes `const plan: PlanId = "pro"` (:107)**; upserts subscriptions row. Ignores `metadata.plan_id`.
   - `handleSubscriptionEvent` (:129-185): finds team by subscription/customer id (:137-144), resolves `plan = resolvePlanFromPrice(priceId)` (:146-147), syncs status/period/customer/subscription id (:153-170), and if `plan` truthy updates `plan` (:172-177); syncs `interval` from price recurring (:179-184).
   - Route: `apps/web/app/api/webhooks/stripe/route.ts` — `constructWebhookEvent` (:22), calls `processStripeEvent(pool, event, resolvePlanFromPrice)` (:34-38); `invoice.payment_failed` → `notifier` (plan 16, :43-60).
5. **Read paths**:
   - `getSubscriptionView` (`billing.ts:169-200`) → free-view without stripe id (:174-183); else DB row + 1 live Stripe call.
   - `GET /api/billing/subscription` (subscription/route.ts:25-38) validates with `subscriptionResponseSchema`.
   - Billing page `apps/web/app/(dashboard)/billing/page.tsx` — `plans[usage.plan.id]` (:34), `isPro = plan.id === "pro"` (:35).
   - Pricing cards `apps/web/components/pricing-cards.tsx` — `plan.id === "pro"` highlight (:98), CTA (:157,162), button label (:178).

### 1.3 Feature gates at runtime

- **Feature-based** (`plan.features.*` / `assertPlanFeature`):
  - `packages/scan-core/src/credits.ts:217-227` `assertPlanFeature(db, teamId, "uptime"|"github"|"activeTests"|"onDeploy")`.
  - Callers: `apps/web/lib/deploy-webhooks.ts:113` (onDeploy); `apps/web/app/api/sites/route.ts:76` (github); `apps/web/app/api/sites/[id]/route.ts:106` (github).
  - Direct `plan.features` reads: `apps/web/app/api/scans/route.ts:48` (activeTests → 403 + upsell :47-58), `apps/web/app/(dashboard)/sites/page.tsx:36,38` (github/activeTests props), `apps/web/app/(dashboard)/sites/[id]/page.tsx:161` (onDeploy), `pricing-cards.tsx:131-141` (uptime/github display).
- **Plan-IDENTITY gates** (`plan.id === "pro"` / `!== "pro"`) — **the critical broadening scope (MFL-008)**:
  1. `apps/web/app/(dashboard)/billing/page.tsx:35` (`isPro` → BillingManager + pro-only copy/PM rendering :66-87)
  2. `apps/web/components/billing-manager.tsx:17,21,88-89` (`isPro` prop → manager actions)
  3. `apps/web/app/api/threats/route.ts:31` (→ 403 + `upsell:{plan:"pro"}`, feature:"threats")
  4. `apps/web/app/api/threats/events/route.ts:32` (same)
  5. `apps/web/app/api/sites/[id]/honeypot/route.ts:36` (same)
  6. `apps/web/app/api/sites/[id]/schedule/route.ts:44-56` (403 + upsell, feature:"schedule")
  7. `apps/web/app/(dashboard)/threats/page.tsx:41` (→ ThreatsUpsell)
  8. `apps/web/app/(dashboard)/sites/page.tsx:37` (`schedulingEnabled={plan.id === "pro"}`)

### 1.4 Invite path exact contract

- `apps/web/lib/invites-core.ts`:
  - `InviteErrorCode` (:7-15) includes `"member_limit"`. `InviteError` class (:17-25) carries `code` + `message`.
  - `maxMembersForTeam` (:62-72): `select plan from subscriptions` (:66-69), returns `plans[planId].maxMembers` (:71). **This is the limit-source function to change.**
  - `assertSeatAvailable(db, teamId, countSeats)` (:74-87): `seats >= maxMembers` → throw `InviteError("member_limit", "De ledenlimiet van dit plan (${maxMembers}) is bereikt. Upgrade naar Pro voor meer leden.")`.
  - `createInvitation` (:89-149): within a transaction, checks already_member (:98-106), pending_exists (:108-115), then `assertSeatAvailable` with seats = **accepted memberships + unexpired pending invites** (:117-129).
  - `acceptInvitation` (:166-227): checks not_found/expired/already_accepted/email_mismatch (:170-185), then `assertSeatAvailable` with seats = **accepted memberships only** (:197-204).
- Error→status maps:
  - POST `apps/web/app/api/teams/[teamId]/invitations/route.ts:56-60`: `already_member`/`pending_exists` → 409; **everything else (incl. member_limit) → 400; NO upsell payload.**
  - POST `apps/web/app/api/invitations/[token]/accept/route.ts:27-36`: not_found→404, expired→410, email_mismatch→403, else (incl. member_limit) → 400.
- Client invite UI: `apps/web/components/team-settings.tsx:50-72` `sendInvite` shows `data.error` only; **no client branch on `member_limit` or `data.upsell`** (grep `member_limit` → only invites-core + tests; grep `upsell` in team-settings → none). Other clients that DO branch: `sites-manager.tsx:171` (`data?.upsell`), `scan-result.tsx:793`, `onboarding-wizard.tsx:32` (status 402 + upsell); all POST checkout body `{ planId: upsell?.plan ?? "pro" }` (sites-manager:335, onboarding-wizard:51).

### 1.5 Test seams

- **credits.test.ts** (`apps/web/lib/__tests__/credits.test.ts`): `fakePool()` (:34-143) is a Map of `FakeSubscription {team_id, plan, status, current_period_end, credits_used, stripe_subscription_id}`; `select team_id, plan, ...` handler (:60-66). Plan lookup is NOT faked — it goes through the real `plans` record. A Max-plan test needs only `subscriptions.set("team-1", {...plan: "max" ...})` plus the real `plans.max` entry.
- **invites-core.test.ts**: `fakePool()` (:42-246) stores `subscriptions: {team_id, plan}[]` (:55-57); handler `select plan from subscriptions` (:182-188). Limit resolution goes through the real `plans` record → a Max test sets `state.subscriptions[0].plan = "max"`. Existing member-limit tests: :295-301 (create blocked at free limit 3), :303-311 (pro allows 3 more), :382-394 (accept blocked at limit).
- **billing-core.test.ts**: `fakePool()` subscriptions array (:23-130); `resolveProPrice = (priceId) => priceId === "price_pro" ? "pro" : null` (:132-133) — the webhook plan resolver is **injected**, so a Max webhook test needs a resolver that maps a max price id → "max". Checkout event fixture has `metadata: {team_id, plan_id: "pro"}` (:144) — note `plan_id` is currently ignored by `handleCheckoutCompleted`.
- **billing.test.ts**: mocks `@/lib/env` with `{ stripePricePro: "price_pro_month", stripePriceProAnnual: "price_pro_year", ... }` (:23-31); `resolvePlanFromPrice` assertions :49-56; checkout assertions :58-113; `switchSubscriptionInterval` :201-213.
- **billing-routes.test.ts**: route-level mocks of `@/lib/billing`, `@/lib/credits`, `@/lib/api-auth`; `PRO_SUB`/`PRO_VIEW` fixtures :61-95; checkout POST test :249-276.
- **Pricing UI tests**: none exist (glob `*plans*.test.ts` → 0). `GET /api/plans` has no route test.
- **No testcontainers/DB**: hand-rolled `fakePool()` + `vi.mock` only (phase-1 audit :84-88).

### 1.6 Downgrade/upgrade semantics

- Plan changes come ONLY through Stripe webhooks (`customer.subscription.*` → `handleSubscriptionEvent`), which resolve plan from the price on the subscription items (:146-147, :172-177). Downgrades/upgrades are therefore price-driven and free; **no manual plan column writes** except `ensureSubscriptionRow` (free default) and `handleCheckoutCompleted` (currently hardcoded "pro").
- No migration or backfill needed to switch an existing free/pro row to max: migration 026 already extended the check constraint to `('free','pro','max')` (`026_team_seats_white_label.sql:34-37`) and `packages/db/src/index.ts:6` `planIds` already includes "max". Existing rows keep working.
- **Hard ordering constraint (MFL-005)**: `packages/shared/src/plans.ts` must gain "max" (schema + record + planList) BEFORE any code can write/read a `'max'` row — otherwise `plans[planId].maxMembers` / `.creditsPerPeriod` / `.apiRatePerMinute` indexes throw on `undefined`.
- Downgrade behavior is lenient by design: `getTeamUsage` shows creditsUsed above the limit without data loss (credits.test.ts:281-295); spendCredit blocks only on the next scan after downgrade (:250-263); seats per MFL-003: active memberships are not removed on downgrade, invites just stop.

---

## 2. UNKNOWN / decision points (for orchestrator)

1. **Upsell next-plan for member_limit**: free (limit 3) → "pro" (limit 10) is clear. Pro (limit 10) and max (seats 3) have NO higher member tier (per MFL-003 max seats=3). Decide: pro/max member-limit → 409 with no upsell, or 409 + upsell to "max"/"pro" for the non-member features. Recommendation: `nextPlanForMemberLimit`: free → "pro", pro/max → null (no upsell).
2. **`handleCheckoutCompleted` plan source**: switch from hardcoded "pro" to `metadata.plan_id` (validated). Default for legacy events missing `plan_id`: "pro" (preserves today's behavior).
3. **Accept route member_limit**: change 400 → 409 too (no upsell payload; the accepter is not necessarily the owner). Alternatively leave 400. Recommendation: 409, consistent code, no upsell.
4. **Max pricing**: `priceCents`/`annualPriceCents` values are display-only; real price lives in Stripe (`STRIPE_PRICE_MAX`/`_ANNUAL`). Choose display values for pricing-cards.
5. **`maxMembers` for the max plan**: set 3 (== seats) so `pricing-cards.tsx:128` and billing page copy stay truthful, or keep a larger number and rely on `features.seats ?? maxMembers` = 3. Recommendation: `maxMembers: 3` + `features.seats: 3` (single source of truth) — then the `??` is moot for max but exercised for free/pro.

---

## 3. Construction-ready task units

### Unit A — `packages/shared` Max-plan contract (MUST ship first; MFL-005)
**Files (1):**
- `packages/shared/src/plans.ts`:
  - :3 `planIdSchema = z.enum(["free","pro","max"])`.
  - :27-34 `Plan["features"]` += `seats: number | null` and `white_label: boolean` (recommendation: `seats` nullable so `features.seats ?? maxMembers` is the exact source; free/pro `seats: null`, `white_label: false`; max `seats: 3`, `white_label: true`).
  - :37-59 add `max` entry (id "max", name "Max", priceCents per decision (Q4), optional annualPriceCents, creditsPerPeriod (recommend > pro, e.g. 2000), maxMembers 3, apiRatePerMinute (>= pro, e.g. 240), maxWebhooks (>= pro), features all true + seats 3 + white_label true).
  - :61 `planList = [plans.free, plans.pro, plans.max]`.
  - :63-78 `publicPlanSchema.features` mirror the two new fields (`seats: z.number().int().positive().nullable()`, `white_label: z.boolean()`).
  - `subscriptionSchema`/`usageSchema` follow automatically from `planIdSchema`/`publicPlanSchema`.
- NOTE: `packages/shared/src/index.ts` re-exports `./plans` (:106) — no change needed.
**Evidence/tests:** shared `plans` has no dedicated test file; add assertions in any existing shared test or rely on `apps/web` route tests. Minimal: a schema parse test (`planIdSchema.parse("max")`) — check `packages/shared/src/__tests__/` for placement.

### Unit B — Stripe price/env wiring
**Files:**
- `apps/web/lib/env.ts`: add `STRIPE_PRICE_MAX` (+ `STRIPE_PRICE_MAX_ANNUAL` if annual max is desired) `z.string().min(1).optional()` near :17-19; export `stripePriceMax` (:51-52 area). Update `apps/web/.env.example` (near :71-75).
- `apps/web/lib/billing.ts`:
  - `resolvePlanFromPrice` (:24-29): add `|| priceId === env.stripePriceMax (|| env.stripePriceMaxAnnual)` → `return "max"`.
  - `createCheckoutSession` (:44): branch price on `input.planId`: `planId === "max" ? (interval === "year" ? env.stripePriceMaxAnnual : env.stripePriceMax) : (interval === "year" ? env.stripePriceProAnnual : env.stripePricePro)`. `metadata.plan_id` already sent (:58).
  - `switchSubscriptionInterval` (:260-275): needs the current plan to pick the right price pair. Change signature to accept `planId` (or read `getSubscriptionState`), then branch as above.
- `apps/web/app/api/billing/subscription/route.ts`: PATCH handler calls `switchSubscriptionInterval(stripe_subscription_id, parsed.data.interval)` (:59-62) — pass the team's current plan (`getSubscriptionState` already fetched at :52).
- `apps/web/app/api/billing/checkout/route.ts`: no code change (schema + free-reject logic already generic); confirm `billingCheckoutSchema` accepts "max" after Unit A.
- `apps/web/lib/billing-core.ts` `handleCheckoutCompleted` (:107): replace `const plan: PlanId = "pro"` with validation of `object.metadata?.plan_id` (safeParse against `planIdSchema`, default "pro" when absent/invalid).

### Unit C — Paid-plan identity gates (MFL-008)
Add a shared helper, e.g. `isPaidPlan(id: PlanId): boolean` in `packages/scan-core/src/credits.ts` (re-exported by `apps/web/lib/credits.ts`) or in `packages/shared`. Then switch these 8 sites from `plan.id === "pro"` / `!== "pro"` to the helper:
1. `billing/page.tsx:35` → `isPaid = isPaidPlan(plan.id)`; pass `isPaid` to `BillingManager` (rename prop `isPro` → `isPaid` in `billing-manager.tsx:17,21,88-89`).
2. `billing-manager.tsx` prop rename + `isProActive` (:88-89) uses `isPaid`.
3. `apps/web/app/api/threats/route.ts:31`
4. `apps/web/app/api/threats/events/route.ts:32`
5. `apps/web/app/api/sites/[id]/honeypot/route.ts:36`
6. `apps/web/app/api/sites/[id]/schedule/route.ts:46`
7. `apps/web/app/(dashboard)/threats/page.tsx:41`
8. `apps/web/app/(dashboard)/sites/page.tsx:37`
(Keep `features.*` gates as-is — they follow the max record automatically.)

### Unit D — Invite seat-limit change (plan 64 step 2 core)
**Files:**
- `apps/web/lib/invites-core.ts`:
  - Replace `maxMembersForTeam` (:62-72) with a limit-source function reading the full plan: `const plan = plans[planId]; return plan.features.seats ?? plan.maxMembers;`. (Optional: reuse `getPlanForTeam` from `@/lib/credits` — it does a wider SELECT; either works, keep the local query for minimal churn.)
  - `assertSeatAvailable` (:74-87) unchanged in structure; update the thrown message to be next-plan-agnostic (route builds the upsell) or have the route build both. Recommendation: keep `InviteError("member_limit", ...)` and build `upsell` in the route.
- `apps/web/app/api/teams/[teamId]/invitations/route.ts:56-60`: map `err.code === "member_limit"` → **409** + `{ error: err.message, upsell: { plan: nextPlan, feature: "seats" } }` where `nextPlan` comes from a helper (`free → "pro"`, else null → no upsell key, pending orchestrator decision Q1). `already_member`/`pending_exists` keep 409 (no upsell). Route already imports `getPlanForTeam`? No — import `getPlanForTeam` from `@/lib/credits` to compute next-plan.
- `apps/web/app/api/invitations/[token]/accept/route.ts:27-36`: change `member_limit` → 409 (decision Q3).
- **Client invite UI (optional but recommended for the acceptance criterion "invite bij limiet → 409 + upsell" to be user-visible)**: `apps/web/components/team-settings.tsx:50-72` — branch on `data?.upsell` like `sites-manager.tsx:171` and render an upsell modal (copy from `sites-manager.tsx:707-732`) whose upgrade button POSTs `{ planId: data.upsell.plan }` to `/api/billing/checkout`.

### Unit E — Pricing/billing UI for max
- `apps/web/components/pricing-cards.tsx`: grid `md:grid-cols-2` → 3 cols (:87); `plan.id === "pro"` highlight (:98) → make max the highlighted tier (or pro+max); register CTA conditionals (:157,162); button busy/label logic (:178) currently `busy === "pro"` / "Upgrade naar Pro" → genericize (e.g. `busy === plan.id`, "Upgrade naar {plan.name}"); optional: list seats/white-label feature rows from `plan.features.seats`/`white_label`.
- `apps/web/app/(dashboard)/billing/page.tsx`: `isPro` copy (:66-69) pro-only text → branch on plan (max copy mentions seats/white-label); `BillingManager` prop via Unit C.
- `apps/web/app/(dashboard)/sites/page.tsx` / `[id]/page.tsx`: no copy change strictly required (feature props drive it), verify after Unit C.

---

## 4. Test changes (existing lines that will need updating)

| File | Line(s) | Change |
|---|---|---|
| `apps/web/lib/__tests__/billing.test.ts` | :23-31 | env mock += `stripePriceMax: "price_max_month"` |
| | :49-56 | `resolvePlanFromPrice("price_max_month")` → "max"; keep null cases |
| | :58-113 | add checkout test: planId "max" → `line_items[0].price === "price_max_month"`, metadata `plan_id: "max"` |
| | :201-213 | if `switchSubscriptionInterval` becomes plan-aware, add max-price case |
| `apps/web/lib/__tests__/billing-core.test.ts` | :132-133 | resolver += max price id → "max" |
| | :158-172 | after `handleCheckoutCompleted` change: existing test (metadata `plan_id:"pro"`) still passes; add test metadata `plan_id:"max"` → row plan "max"; add legacy-no-plan_id → "pro" default test |
| `apps/web/lib/__tests__/billing-routes.test.ts` | :249-276 | add POST `{ planId: "max" }` → `createCheckoutSession` called with planId "max" |
| `apps/web/lib/__tests__/invites-core.test.ts` | :295-311 | keep; optionally add max-limit test (`state.subscriptions[0].plan = "max"` → 2 members + 1 pending → member_limit; 1 member + 1 pending ok) |
| | :382-394 | keep; optionally add max accept-limit test |
| `apps/web/lib/__tests__/credits.test.ts` | :266-334 | add `getPlanForTeam`/`assertPlanFeature` on a max row (features all true; limit = plans.max.creditsPerPeriod) |
| New | — | route test for `POST /api/teams/:teamId/invitations` member_limit → **409 + upsell payload** (pattern: `scans-route.test.ts:104-120`; needs `vi.mock("@/lib/api-auth")` + `vi.mock("@/lib/email")`); optional `plans-route.test.ts` (3 plans) |

**New behavior tests must fail before the change and pass after** (e.g. the 409+upsell route test fails today because the route returns 400 with no upsell; the checkout-max test fails today because `resolvePlanFromPrice` returns null and `createCheckoutSession` uses the pro price).

---

## 5. Verification commands

```bash
pnpm --filter shared typecheck && pnpm --filter shared test
pnpm --filter web typecheck
pnpm --filter web test -- apps/web/lib/__tests__/invites-core.test.ts apps/web/lib/__tests__/billing.test.ts apps/web/lib/__tests__/billing-core.test.ts apps/web/lib/__tests__/billing-routes.test.ts apps/web/lib/__tests__/credits.test.ts
pnpm --filter web lint
pnpm typecheck   # repo-wide (8 packages) after the full change
pnpm lint
```

---

## 6. Recommended merge/commit boundaries

1. Unit A alone (shared max contract) — typechecks, unblocks everything; does NOT write 'max' anywhere yet.
2. Unit B + Unit E tests + Unit E UI (billing functional for max: checkout, webhook sync, pricing cards, billing page).
3. Unit C (identity gates) + tests (threats/honeypot/schedule still 403 for free, now 200 for max).
4. Unit D (invite seat change) + tests (409 + upsell, max-limit core tests, optional client modal).

Units are orderable independently after A; each must pass typecheck + lint + its own tests.
