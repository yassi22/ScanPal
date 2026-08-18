# Review 1 — phase-2-task-A-plans-max-3b8a

## Decision Packet

- **Role / Task ID:** REVIEWER — phase-2-task-A-plans-max-3b8a (shared billing contract: max plan)
- **Status/verdict:** PASS
- **Read-only review scope:** `packages/shared/src/plans.ts` (mod), `packages/shared/src/__tests__/plans.test.ts` (new) — no files modified by reviewer
- **Criteria summary:** all 5 acceptance criteria PASS with independently re-derived evidence (below)
- **Verification summary:** shared suite 39 files / 568 tests green (plans.test.ts 11); root `pnpm typecheck` exit 0; `pnpm lint` exit 0; scope-baseline hash compare 40/40 baseline files → exactly 1 mismatch (plans.ts, the declared mod); `plans.test.ts` the only new file vs baseline inventory; consumer grep complete
- **Scope/preservation result:** PASS — only `plans.ts` changed + `plans.test.ts` added within declared scope; index.ts byte-identical (`D9F5D3E3…`); all 38 pre-existing shared tests byte-identical; no existing test modified
- **Major-log ids:** MFL-20260818-011 (reviewer verification note, appended)
- **Unresolved risks/blockers:** none task-relevant. Forward-looking consumers listed below (pricing UI → task E, Stripe price wiring → task B) — expected, not defects
- **Evidence paths:** this file; scope-baseline.json; implementer-report.md; `packages/shared/src/plans.ts`; `packages/shared/src/__tests__/plans.test.ts`; command outputs recorded below
- **FAST-PATH ELIGIBLE:** YES — review independent, required verification complete, scope/preservation evidence clean, no conflict requiring orchestrator investigation

---

## Acceptance criteria verdict (independently re-derived)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | planIdSchema accepts free/pro/max; plans.max values | **PASS** | plans.ts:3 enum; :77-94 max record; pro authorities :59-76 |
| 2 | free/pro unchanged + additive seats/white_label | **PASS** | git diff (below): purely additive; free/pro existing field values byte-identical in diff |
| 3 | planList 3 entries; publicPlanSchema mirrors fields + parses max | **PASS** | plans.ts:97, :113-114; test :85-92 asserts parsed seats===3 / white_label===true |
| 4 | New tests pass; shared suite; typecheck; lint | **PASS** | 11/11 plans tests; 568/568 shared; typecheck exit 0; lint exit 0 |
| 5 | Only declared files changed; no existing test modified | **PASS** | hash compare + git status delta vs changed-paths-inventory.txt |

## Command evidence (real output, this review)

1. `pnpm --filter @scanpal/shared test` → **39 passed (39), 568 passed (568)**, duration 5.37s.
2. `pnpm --filter @scanpal/shared test -- src/__tests__/plans.test.ts` → **1 passed (1), 11 passed (11)**.
3. `pnpm typecheck` (root = `pnpm -r typecheck`, 8 packages) → all `Done`, `TYPECHECK_EXIT=0` (re-run for exit code).
4. `pnpm lint` (root = `pnpm --filter web lint`) → eslint clean, `LINT_EXIT=0`. Note: shared package has no lint script (package.json: only typecheck+test), so this is the maximum lint coverage that exists.
5. `git status --porcelain` + hash compare vs scope-baseline.json:
   - Re-derivation script over all 40 baseline-hashed files: **exactly 1 mismatch** — `packages/shared/src/plans.ts` `AA835C05…` → `D84A5E70…`. index.ts `D9F5D3E3…` matches baseline; all 38 pre-existing test files match.
   - `plans.test.ts` NOT in baseline files map (confirmed False) → it is the task's only new file.
   - Delta of current `git status` vs changed-paths-inventory.txt (baseline): exactly `M packages/shared/src/plans.ts` + `?? packages/shared/src/__tests__/plans.test.ts`. No other path appears/disappears.

## Diff review (vs git HEAD, `packages/shared/src/plans.ts`)

- `planIdSchema` → `z.enum(["free", "pro", "max"])` (+1 token).
- `Plan.features` + `seats: number | null` + `white_label: boolean` with plan-64 comments (Dutch, house style).
- free/pro: feature object expanded to multiline, **only** `seats: null` + `white_label: false` added; `priceCents 0/2900`, `annualPriceCents (pro) 29000`, `creditsPerPeriod 5/500`, `maxMembers 3/10`, `apiRatePerMinute 60/120`, `maxWebhooks 1/3` untouched. No field reordering of the untouched top-level fields.
- `max`: id "max", name "Max", priceCents 11600, annualPriceCents 116000, creditsPerPeriod 2000, maxMembers 3, apiRatePerMinute 240, maxWebhooks 3, features all true + seats 3 + white_label true. Field order mirrors pro.
- `planList = [plans.free, plans.pro, plans.max]`.
- `publicPlanSchema.features` + `seats: z.number().int().positive().nullable()` + `white_label: z.boolean()`.

## Named-authority check (pro values used for the 4× math and webhooks)

- pro.priceCents = **2900** → max 11600 = 2900×4 ✓
- pro.annualPriceCents = **29000** (present, not undefined — resolves risk hypothesis 1) → max 116000 = 29000×4 ✓
- pro.maxWebhooks = **3** → max.maxWebhooks 3 (= pro's value) ✓
- MFL-20260818-010 decisions implemented as-is: maxMembers 3 (== features.seats 3), credits 2000, api 240, display price 4× pro. ✓

## Test-integrity audit (plans.test.ts, 11 tests)

- planIdSchema: accepts free/pro/max (3 asserts) + rejects unknown ("enterprise") — asserts both directions of the enum extension.
- plans.max shape: `plans.max.id === "max"`, seats 3, white_label true.
- limits: exact literals 2000 / 3 / 240 / 3.
- prices: `plans.max.priceCents === plans.pro.priceCents * 4` and `annualPriceCents === pro.annualPriceCents! * 4` — asserts the relationship, not a hard-coded duplicate (would fail if pro changed).
- feature flags all true.
- free/pro: `seats` null + `white_label` false; `toMatchObject` guards existing values (free has `not.toHaveProperty("annualPriceCents")`, pro includes 29000).
- planList: length 3 + exact order.
- publicPlanSchema: parses max AND asserts `parsed.data.features.seats === 3` / `white_label === true` (meaningful — if `seats` were absent from the schema, `safeParse(plans.max)` succeeds but the value assert fails; if required and missing from data, parse fails). Not a tautology. Free/pro parse with seats null.
- No test modified, deleted, skipped, or weakened. All 11 fail-before/pass-after reasoning holds: e.g., the free/pro `toMatchObject` tests would have failed on the pre-change file because the features object did not carry seats/white_label only in the *data* sense — the schema/type addition is validated by the publicPlanSchema parse tests.

## Consumer impact (grep `planList|publicPlanSchema|planIdSchema` + `plans[`/`plans\.`)

Predicate: ripgrep across `packages` + `apps` (excl. node_modules/dist) for `planList|publicPlanSchema|planIdSchema`, and `plans\[|plans\.(free|pro|max)`; plus test files asserting plan counts.

- `apps/web/app/api/plans/route.ts:8` — `planList.map(p => publicPlanSchema.parse(p))`; now returns 3 plans incl. seats/white_label. **Parses, not broken** (this is the intended API shape; GET /api/plans consumers: pricing page + `authz-matrix.test.ts:132` asserts only `length > 0`).
- `apps/web/app/pricing/page.tsx:63` + `components/pricing-cards.tsx` — renders a third card (grid-cols-2 wraps). Not broken; pricing UI polish is **task E**.
- `apps/web/app/api/billing/checkout/route.ts` + `lib/billing.ts:39-76` — `billingCheckoutSchema` now accepts "max" (intended contract extension). Checkout still charges the pro price for any plan (`createCheckoutSession` ignores planId for price selection, metadata carries `plan_id`). **Not broken (no crash; graceful error paths intact)**; Stripe price wiring for max is **task B**. Existing checkout tests use planId "pro" only — none assert rejection of "max".
- `packages/shared/src/billing.ts:10,49` — checkout/subscription schemas now accept "max"; intended.
- `packages/scan-core/src/credits.ts:43,83`, `apps/scheduler/src/credits.ts:48`, `apps/web/lib/invites-core.ts:71` — `plans[planId]` indexing. With `plans` now exhaustive over `Record<PlanId, Plan>` (typecheck-enforced), the MFL-20260818-005 `plans['max'] === undefined` hazard is **resolved** for these paths. Not broken.
- No test asserts `planList.length === 2`, a 2-plan set, or rejects "max" (verified: billing/shared tests use only free/pro values; web billing-routes/credits/invites-core tests use free/pro).

## Scope / preservation

- index.ts byte-identical to baseline (hash `D9F5D3E3…`).
- No file outside the declared scope touched by this task (git status delta = baseline inventory + exactly the 2 declared paths).
- Free/pro values preserved (diff review above). Conventions: Dutch plan-64 comments, zod-only shared package, single planList source of truth (no duplicate plan definitions anywhere — grep across packages/apps for plan-list duplicates: 0 hits).

## SHORTCUT audit

No stubs, TODOs, placeholders, dead code, hard-coded-temp values, or partial wiring. `11600/116000` are the prescribed MFL-010 display values (test-guarded by the 4×-pro relationship asserts), not temp values.

## Risk hypotheses

1. 4× pro math / pro annual undefined — **resolved**: pro.annualPriceCents = 29000 exists; 116000 = 4× correct.
2. publicPlanSchema mirror / GET /api/plans shape — **resolved**: schema mirrors the new fields; the new test covers the max shape with value asserts; the plans route parses all 3.
3. Tautological tests — **resolved**: tests assert literals, the pro-relationship, and parsed schema values; meaningful in both failure directions.

## Pre-existing / forward-looking consumers (listed, NOT fixed — out of this task's scope)

- Pricing UI third card: task E.
- Checkout Stripe price mapping for max (`lib/billing.ts` `createCheckoutSession` + `resolvePlanFromPrice` returns null for max → webhook sync defaults pro): task B.
- Identity gates (`plan.id === "pro"`) for threats/honeypot/schedule/billing page: task B/C (see MFL-20260818-008).

---

VERDICT: PASS
