# Implementer Report — phase-2-task-B-stripe-max-7c1d

## Decision Packet

- **Role / task**: Implementer — `phase-2-task-B-stripe-max-7c1d` (billing/Stripe wiring, plan 64 step 2 / discovery Unit B)
- **Status**: COMPLETE — all 6 acceptance criteria PASS; all verification commands green
- **Changed paths** (exactly the 8 declared): `apps/web/lib/env.ts`, `apps/web/.env.example`, `apps/web/lib/billing.ts`, `apps/web/lib/billing-core.ts`, `apps/web/app/api/billing/subscription/route.ts`, `apps/web/lib/__tests__/billing.test.ts`, `apps/web/lib/__tests__/billing-core.test.ts`, `apps/web/lib/__tests__/billing-routes.test.ts`. Plus this report (`phases/phase-2/phase-2-task-B-stripe-max-7c1d/implementer-report.md`).
- **Criteria summary**: env exports max prices (AC1 PASS); resolvePlanFromPrice maps max→"max" (AC2 PASS); checkout uses max price both intervals, pro/free unchanged (AC3 PASS); switch plan-aware + all callers updated (AC4 PASS); webhook validates metadata.plan_id default "pro" (AC5 PASS); tests fail-before/pass-after, full web billing set + typecheck + lint + scope clean (AC6 PASS).
- **Verification summary**: billing tests 47/47 PASS; `pnpm --filter web typecheck` PASS; `pnpm typecheck` (8 pkgs) PASS; `pnpm lint` PASS; `git status` delta = exactly the 7 git-tracked scope files (`.env.example` gitignored, content-verified).
- **Scope/preservation**: pro/free prices+metadata unchanged; `handleSubscriptionEvent` injected-resolver contract unchanged; pre-existing baseline worktree changes untouched.
- **Major-log ids**: MFL-20260818-012 (`.env.example` gitignored — verification-method correction).
- **Unresolved risks/blockers**: none. (`.env.example` invisible to git — documented, not blocking.)
- **Evidence paths**: this report; `scope-baseline.json` (runs dir); verification command output recorded below; fail-before demo output in `C:\Users\Yassin\AppData\Local\Temp\opencode\task-b-fail-before` (backup only).
- **FAST-PATH ELIGIBLE**: YES — clean single-unit implementation, all criteria met with reproducible evidence.

## What I implemented

1. `apps/web/lib/env.ts` — added `STRIPE_PRICE_MAX` + `STRIPE_PRICE_MAX_ANNUAL` (`z.string().min(1).optional()`, right after the pro-annual line, same placement/comment style) and exports `stripePriceMax` / `stripePriceMaxAnnual` next to the pro exports.
2. `apps/web/.env.example` — documented both new vars next to the pro-annual line, same commented style + `tax_behavior = exclusive` note.
3. `apps/web/lib/billing.ts`:
   - `resolvePlanFromPrice`: added max-monthly/max-annual mapping → `"max"` (mirrors the pro cases; an undefined env var can never match, preserving the old null fallback).
   - `createCheckoutSession`: price branches on `input.planId === "max"` (year ? max-annual : max) else the existing pro behavior. `metadata.plan_id` was already sent.
   - `switchSubscriptionInterval`: signature now `(subscriptionId, interval, planId: PlanId)` — required third param, price pair branches on `planId === "max"` the same way.
4. `apps/web/app/api/billing/subscription/route.ts` — PATCH passes `subscription.plan` (from `getSubscriptionState`, available at the existing line 52) to `switchSubscriptionInterval`.
5. `apps/web/lib/billing-core.ts` — `handleCheckoutCompleted` replaces the hardcoded `plan: PlanId = "pro"` with `planIdSchema.safeParse(object.metadata?.plan_id)`; `"pro"` when missing/invalid (legacy default).
6. Tests (all new assertions fail-before/pass-after, see below):
   - `billing.test.ts`: env mock += max prices; `resolvePlanFromPrice` max cases; checkout `planId "max"` asserts `line_items[0].price` = max price (month + year) and metadata `plan_id: "max"`; existing switch test updated to 3-arg call; new switch-max test.
   - `billing-core.test.ts`: resolver fixture renamed `resolveProPrice` → `resolvePlanFromPrice` and maps `price_max` → `"max"`; new tests for checkout `metadata.plan_id "max"` → row plan `"max"`, legacy checkout without `plan_id` → `"pro"`, invalid `plan_id` → `"pro"`.
   - `billing-routes.test.ts`: PATCH switch assertion updated to `("sub_1", "year", "pro")`; new checkout-POST test with `{ planId: "max" }` asserting `createCheckoutSession` called with `planId "max"`.

## Acceptance criteria — per-criterion PASS/FAIL

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | env.ts exports stripePriceMax(+Annual); .env.example documents them | PASS | `env.ts:20-23,57-58`; `.env.example:78-79` (`rg STRIPE_PRICE_MAX`), `git diff` in evidence below |
| 2 | resolvePlanFromPrice maps max prices → "max" (pro kept) | PASS | `billing.ts:29-31`; test `billing.test.ts:52-56`; fail-before: `expected null to be 'max'` |
| 3 | createCheckoutSession(planId "max") uses max price both intervals; pro/free unchanged | PASS | `billing.ts:47-54`; test `billing.test.ts` "gebruikt de max-price"; existing pro month/year tests still green (price_pro_month/price_pro_year) |
| 4 | switchSubscriptionInterval plan-aware; all callers updated | PASS | `billing.ts:272-281`; caller grep = only `subscription/route.ts:59` + tests, both updated; PATCH test asserts 3-arg call |
| 5 | handleCheckoutCompleted writes validated metadata.plan_id (default "pro") | PASS | `billing-core.ts:107-110`; tests: max → "max", legacy → "pro", invalid → "pro" |
| 6 | New tests fail-before/pass-after; billing set + typecheck + lint pass; scope clean | PASS | 5 tests fail on pre-change code, 47/47 pass after; typecheck/lint green; git status delta exact |

## Verification — real command output

### Fail-before (new tests vs pre-change production code, `git checkout HEAD --` on the 4 production files)
```
Test Files  3 failed (3)
     Tests  5 failed | 42 passed (47)
```
Failures (all the new behavior assertions):
- billing.test `resolvePlanFromPrice … max` → `expected null to be 'max'`
- billing.test checkout max → `expected 'price_pro_month' to be 'price_max_month'`
- billing.test switch max → `"price_max_year"` vs received `"price_pro_year"`
- billing-core.test max checkout → `"plan": "max"` vs received `"plan": "pro"`
- billing-routes.test PATCH switch → `expected "spy" to be called with arguments: [ 'sub_1', 'year', 'pro' ]` (received 2-arg call)

Contract-lock tests (legacy default → "pro", invalid → "pro", checkout-POST max wiring) pass on old code by design — they lock the pre-existing default "pro" behavior and the wiring contract.

### 1. Billing test set (after restore of implementation)
```
pnpm --filter web test -- lib/__tests__/billing.test.ts lib/__tests__/billing-core.test.ts lib/__tests__/billing-routes.test.ts
✓ lib/__tests__/billing-core.test.ts (14 tests)
✓ lib/__tests__/billing-routes.test.ts (20 tests)
✓ lib/__tests__/billing.test.ts (13 tests)
Test Files  3 passed (3)
     Tests  47 passed (47)
```
Note: the task's command used `apps/web/lib/__tests__/…` paths; vitest in the web app is rooted at `apps/web` (include `lib/**/*.test.ts`), so paths must be relative to the app root. Same three files, same coverage.

### 2. Web typecheck
```
pnpm --filter web typecheck → tsc --noEmit → (no output, exit 0)
```

### 3. Root typecheck
```
pnpm typecheck → pnpm -r typecheck → Scope: 8 of 9 workspace projects … all Done
```

### 4. Lint
```
pnpm lint → pnpm --filter web lint → eslint → (no output, exit 0)
```

### 5. Scope check
- `git status --porcelain` delta vs the pre-existing baseline: exactly 7 new modifications — `apps/web/app/api/billing/subscription/route.ts`, `apps/web/lib/__tests__/billing-core.test.ts`, `apps/web/lib/__tests__/billing-routes.test.ts`, `apps/web/lib/__tests__/billing.test.ts`, `apps/web/lib/billing-core.ts`, `apps/web/lib/billing.ts`, `apps/web/lib/env.ts` (plus untracked `phases/` = this report). All other entries identical to the baseline snapshot taken at run start. No packages/shared or packages/db files touched.
- `apps/web/.env.example` is **gitignored** (`apps/web/.gitignore:34` pattern `.env*`) so it cannot appear in git status; verified by content (`rg STRIPE_PRICE_MAX` → lines 78-79 present). Logged as MFL-20260818-012.
- Current disk SHA-256 of the 8 scope files recorded above in evidence; pre-change baseline hashes in scope-baseline.json (all differ, as expected — these are the changed files).

## Deviations

1. Verification command 1 paths adjusted to the web-app vitest root (`lib/__tests__/…` instead of `apps/web/lib/__tests__/…`) — same test files; the literal command errors with "No test files found".
2. `switchSubscriptionInterval`'s new `planId` parameter is **required** (no default) — the only caller (subscription route PATCH) and the tests were updated. This matches the plan instruction ("accept the current planId … update callers").
3. Comment added to `handleCheckoutCompleted` (2-line Dutch note on the plan_id fallback). This is a minimal explanatory comment matching the codebase's established Dutch comment style (e.g. `billing.ts:55-56`), not decorative noise.
4. Fail-before proof used `git checkout HEAD -- <4 files>` with a temp backup (restored afterward); working tree re-verified to match the edited state. No test was modified, weakened, or skipped.

## Collateral impact

- `createCheckoutSession` input shape unchanged; only consumer `app/api/billing/checkout/route.ts` needed no edit (planId already flows through `billingCheckoutSchema` → accepted, confirmed `packages/shared/src/billing.ts:10`).
- `handleSubscriptionEvent` injected-resolver contract unchanged — `resolvePlanFromPrice` only gained a branch.
- `getStripeSubscription`, `cancelSubscription`, `reactivateSubscription`, `listInvoices`, portal, webhook construction: untouched.
- The pro-price `BillingNotConfiguredError` test (`billing.test.ts:99-112`) still passes — planId "pro" falls through to the pro branch.

## Reuse / architecture notes

- No new modules; all changes extend the canonical existing functions (`resolvePlanFromPrice`, `createCheckoutSession`, `switchSubscriptionInterval`, `handleCheckoutCompleted`). Price-pair branching mirrors the existing ternary style (`interval === "year"`). `planIdSchema` is reused from `@scanpal/shared` rather than re-declared.

## Assumptions

- Invalid-but-present `metadata.plan_id` (e.g. `"enterprise"`) falls back to `"pro"` per MFL-20260818-010 decision 2; covered by a dedicated test.
- `.env.example` unchanged for `STRIPE_PRICE_PRO` (kept uncommented) while the two new max vars and pro-annual are commented — matches the existing file's "not yet in use" convention.

## Open items

- None within task B scope. Downstream: task C (identity gates `isPaidPlan`), task D (invite 409/upsell), task E (pricing cards UI) are separate units per the plan.
