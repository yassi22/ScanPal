# Phase-2 Billing Discovery Report — Task `phase-2-billing-discovery-6e0b`

**Status: COMPLETE**
**Date:** 2026-08-18
**Deliverable:** construction-ready spec at `discovery-spec.md` (same directory); this report is the narrative + honesty record.

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Discovery Worker — `phase-2-billing-discovery-6e0b` |
| Status | COMPLETE (read-only; no production code written) |
| Changed paths | none project-wide; wrote `discovery-spec.md`, `report.md`, and appended MFL-20260818-008 |
| Criteria summary | Q1 (plans data flow + Stripe price↔plan + feature gates), Q2 (invite contract incl. upsell attach point), Q3 (test seams), Q4 (downgrade/upgrade semantics) — all answered in spec §1 |
| Verification summary | 20+ file reads, 5 grep predicates, phase-1 audit + MFL 001-007 cross-checked; every fact re-derived independently (rule 10/12) |
| Scope / preservation | `packages/shared/src/plans.ts` untouched (read-only per task); baseline (migration 026, shared branding/workspaces/report-tokens, crux index.ts edit) preserved |
| Major-log ids | read MFL-001..007; appended **MFL-20260818-008** (paid-plan identity gates) |
| Unresolved risks / blockers | next-plan upsell mapping (free→pro; pro/max have no higher member tier per MFL-003) is an orchestrator decision; `handleCheckoutCompleted` default for legacy events; accept-route 409 decision; max display pricing; ordering constraint MFL-005 |
| Evidence paths | spec §1 file:line citations; phase-1 audit; MFL log |
| FAST-PATH ELIGIBLE | NO — see spec Decision Packet |

---

## 1. What I did

- Read the plan (docs/plans/64-…md), plan reference, phase-1 audit, MFL log 001-007.
- Traced the full billing path: `packages/shared/src/plans.ts`, `packages/shared/src/billing.ts`, `packages/scan-core/src/credits.ts` (and `apps/web/lib/credits.ts` re-export), `apps/web/lib/env.ts`, `apps/web/lib/billing.ts`, `apps/web/lib/billing-core.ts`, `app/api/billing/{checkout,subscription,usage,invoices,portal}`, `app/api/webhooks/stripe`, `app/api/plans`, `app/(dashboard)/billing/page.tsx`, `components/{billing-manager,pricing-cards}`, `app/pricing/page.tsx`.
- Traced the invite path: `lib/invites-core.ts` (full), `app/api/teams/[teamId]/invitations/route.ts`, `app/api/invitations/[token]/accept/route.ts`, `components/team-settings.tsx`, and the tests.
- Read all relevant tests: invites-core, credits, billing, billing-core, billing-routes, scans-route (upsell pattern), plus migrations 003/012/026 and `packages/db/src/index.ts`.
- Ran grep predicates: plans/planIdSchema/maxMembers consumers, member_limit/upsell, plan.features/seats/white_label, plan-id identity gates, planList/publicPlanSchema, STRIPE_PRICE_PRO.
- Wrote the spec early (within the first ~6 tool calls) and appended; finalized it with full evidence.

## 2. Facts confirmed vs. orchestrator-supplied

- `plans.ts:3` enum free/pro, `maxMembers` :22, features :27-34 — **confirmed** (MFL-005, spec §1.1).
- credits.ts `getPlanForTeam` :60, `assertPlanFeature` :217, `spendCredit` :122 — **confirmed**.
- Invite seat limit exists (`invites-core.ts:62-87`), `createInvitation` :117-129, `acceptInvitation` :197-204, route maps member_limit → 400 no upsell (:56-60), tests :295-311/:382-394 — **confirmed** (matches MFL-001).
- Upsell payload shape `{ error, upsell: { plan } }` + optional `feature`, clients at sites-manager:171, scan-result:793, onboarding-wizard:32, checkout body `{ planId: upsell?.plan ?? "pro" }` — **confirmed**.
- Migration 026 adds 'max' to the subscriptions check; `packages/db/src/index.ts:6` planIds includes "max" — **confirmed**.
- Orchestrator decisions MFL-003 (seats = accepted memberships incl. owner; limit source `features.seats ?? maxMembers`; max seats = 3) — **accepted as the design basis**; I did NOT re-derive them, only verified the code can support them (it can, once plans.ts gains the fields).

## 3. New findings not in the orchestrator brief

1. **MFL-20260818-008**: 8 paid-plan *identity* gates (`plan.id === "pro"` / `!== "pro"`) in billing page, billing-manager prop, threats routes/page, honeypot route, schedule route, sites page. A `max` subscription with all pro features would still be blocked from scheduled scans, threats, and honeypot. This is the largest hidden scope of "wire max through the ENTIRE billing path."
2. **`handleCheckoutCompleted` hardcodes `plan: "pro"`** (billing-core.ts:107) and ignores `metadata.plan_id` even though the checkout session already carries it — so today the webhook is the weakest link for any non-pro plan; the fix is to read+validate `metadata.plan_id`.
3. **`createCheckoutSession` and `switchSubscriptionInterval` ignore `input.planId`** (billing.ts:44, :265) — both only ever pick pro prices.
4. **Schedule route gates on `plan.id !== "pro"`**, not on `plan.features.uptime` — same class as #1.
5. **Scheduler has a second copy of the credit logic** (`apps/scheduler/src/credits.ts:48` `plans[planId].creditsPerPeriod`) that reads `plans[planId]` — safe once plans.ts has "max", but it is a duplicate worth noting for the MFL-005 hazard.
6. Phase-1 audit's "No max anywhere" (:81) re-confirmed, but note its "no pricing UI tests" claim: glob `*plans*.test.ts` → 0, confirmed.

## 4. Inferences (marked)

- (INF) Adding `features.seats: number | null` + `features.white_label: boolean` to `Plan.features` is the least-churn way to satisfy MFL-003's `features.seats ?? maxMembers` and keep `publicPlanSchema`/`usageSchema` in sync. The alternative (top-level `seats` on Plan) would leave `maxMembers` as the sole member display field and diverge from the decided limit-source expression. Not validated by any test yet.
- (INF) Route-level upsell construction (rather than attaching plan info to `InviteError`) matches the existing pattern where routes build `{ error, upsell, feature }` (scans route, threats routes). The `member_limit` code and message stay in the core; only the HTTP mapping + payload change.
- (INF) `getPlanForTeam` (a wider SELECT) vs. the existing narrow `select plan from subscriptions` in `maxMembersForTeam`: reusing the existing narrow query keeps the invite fake-pool test surface unchanged (its `select plan from subscriptions` handler at invites-core.test.ts:182-188 continues to match).

## 5. Assumptions / honest caveats

- I did NOT run any test/typecheck/lint (read-only run; no code changed). All verification is static reads + greps.
- I did not verify the exact Stripe dashboard price-IDs (impossible — external). The spec only prescribes env wiring.
- The `handleCheckoutCompleted` legacy-default recommendation ("pro") preserves current behavior; not validated against real Stripe events, but the existing test fixture (`metadata.plan_id: "pro"`) covers the same shape.
- `packages/shared/src/__tests__/` placement for a max-plan schema test was not inspected (I noted it as a check item, not a fact).

## 6. Deviations

- None: no production code, no test modifications, no commands that mutate anything (only two output files + one MFL append).
- Rule 12 (verify supplied facts): MFL-001 already disproved the plan's "geen seat-limiet" claim; I re-verified the code path rather than re-litigating. All other supplied facts held.

## 7. Residual risks for the implementer

- Apply the units in order (A first) or the `plans[planId]` index hazard from MFL-005 fires the moment a 'max' row exists.
- Broadening identity gates (Unit C) touches the threats/honeypot/schedule 403 tests (threats-route.test.ts:88-95, threats-events-route.test.ts:78-83, site-honeypot-route.test.ts:82-88) — those assert free → 403 + `upsell:{plan:"pro"}` and will still pass; ensure max → 200 gets a test.
- If the team-settings client modal is skipped, the "upsell" remains server-only (visible only to API consumers); the acceptance criterion wording "invite bij limiet → 409 + upsell" is satisfied at the API level, but a user-facing CTA is recommended.

---

**Summary:** The `max` plan requires changes in exactly five layers — `packages/shared/src/plans.ts` (schema+record, first), Stripe env+price resolution+webhook sync (`env.ts`, `billing.ts`, `billing-core.ts`), eight paid-plan identity gates (the hidden scope, MFL-008), the invite seat-limit source + 409/upsell mapping, and pricing/billing UI. The invite change is a small modification of an existing, tested seat-limit mechanism, not net-new work. Full construction spec: `C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-2\phase-2-billing-discovery-6e0b\discovery-spec.md`
