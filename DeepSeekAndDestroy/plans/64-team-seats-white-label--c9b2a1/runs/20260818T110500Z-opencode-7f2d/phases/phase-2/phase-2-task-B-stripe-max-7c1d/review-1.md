# Review 1 — phase-2-task-B-stripe-max-7c1d

## Decision Packet

- **Role/task**: Reviewer (round 1) — phase-2-task-B-stripe-max-7c1d
- **Status/verdict**: PASS — zero task-relevant findings; all 6 acceptance criteria independently re-verified
- **Changed paths**: read-only review; no project file modified
- **Criteria summary**: AC1 env exports+docs ✓ · AC2 resolvePlanFromPrice max→"max" ✓ · AC3 checkout max price both intervals, pro/free unchanged ✓ · AC4 switch plan-aware, sole caller updated ✓ · AC5 webhook validated plan_id default "pro" ✓ · AC6 tests fail-before/pass-after + billing set/typecheck/lint green + scope clean ✓
- **Verification summary**: billing tests 47/47 (14+20+13) PASS; `pnpm --filter web typecheck` PASS; `pnpm typecheck` (8 pkgs) PASS; `pnpm lint` PASS; git-status delta vs baseline inventory = exactly 7 git-tracked task files (+`.env.example` gitignored, content-verified both vars). Literal verification-command 1 path (`apps/web/lib/__tests__/…`) errors "No test files found" because vitest is rooted at `apps/web` with include `lib/**/*.test.ts` — same 3 files run green with app-relative paths (task-spec path issue, not a defect).
- **Scope/preservation result**: exactly the 8 declared files; pro/free behavior and all API contracts preserved; pre-existing baseline worktree changes untouched.
- **Major-log ids**: MFL-20260818-013 (reviewer verification note; confirms MFL-010 decisions, MFL-012 method correction).
- **Unresolved risks/blockers**: none task-relevant.
- **Evidence paths**: this file; scope-baseline.json; changed-paths-inventory.txt; implementer-report.md; run-implementer-1.log (fail-before 5 failed/42 passed); major-findings-and-fixes.md.
- **FAST-PATH ELIGIBLE**: YES — independent review, required verification complete, scope/preservation evidence clean, no orchestrator investigation needed.

---

## Evidence log

### Scope check

- Predicate: `git status --porcelain` minus the pre-existing baseline inventory
  (`changed-paths-inventory.txt`) must equal exactly the 7 git-tracked scope
  files. Compare-Object result: `=>` exactly
  `apps/web/app/api/billing/subscription/route.ts`,
  `apps/web/lib/__tests__/billing-core.test.ts`,
  `apps/web/lib/__tests__/billing-routes.test.ts`,
  `apps/web/lib/__tests__/billing.test.ts`, `apps/web/lib/billing-core.ts`,
  `apps/web/lib/billing.ts`, `apps/web/lib/env.ts` — nothing else, nothing
  removed.
- `apps/web/.env.example`: `git check-ignore -v` → `apps/web/.gitignore:34:.env*`
  (gitignored, invisible to git). Disk hash changed vs baseline
  (`6C81367F…` → `B963E3B1…`) and content verified: lines 76-79 document
  `# STRIPE_PRICE_MAX=price_...` and `# STRIPE_PRICE_MAX_ANNUAL=price_...`
  next to the pro-annual lines, same comment style + tax_behavior note
  (MFL-20260818-012 method applies).
- Current SHA-256 of all 8 scope files recorded in this run (all differ from
  scope-baseline.json pre-change hashes, as expected for the changed set).

### Verification commands (real output)

1. `pnpm --filter web test -- apps/web/lib/__tests__/billing.test.ts …` →
   `No test files found, exiting with code 1` (vitest root = apps/web, include
   `lib/**/*.test.ts`). Re-run with app-relative paths →
   `lib/__tests__/billing-core.test.ts (14 tests) ✓`, `billing-routes (20) ✓`,
   `billing.test.ts (13) ✓` → `Test Files 3 passed (3) · Tests 47 passed (47)`.
   (Only stderr = pre-existing console.error assertion noise in a 500-test.)
2. `pnpm --filter web typecheck` → `tsc --noEmit` exit 0.
3. `pnpm typecheck` → `Scope: 8 of 9 workspace projects … all Done` exit 0.
4. `pnpm lint` → `eslint` exit 0.
5. Scope as above.

### Caller / impact audit

- `switchSubscriptionInterval`: production caller = only
  `apps/web/app/api/billing/subscription/route.ts:59` (PATCH), now passing
  `subscription.plan` (typed `PlanId` — `packages/scan-core/src/credits.ts:10`
  `SubscriptionState.plan: PlanId`). Tests updated to 3-arg. No callers in
  packages/worker/scheduler. No stale 2-arg calls remain.
- `createCheckoutSession`: only consumer
  `apps/web/app/api/billing/checkout/route.ts:40` — input shape unchanged, no
  edit needed; `billingCheckoutSchema` already accepts "max"
  (`packages/shared/src/billing.ts:10` via `planIdSchema`).
- `resolvePlanFromPrice`: consumers `billing-core.ts` (injected resolver —
  contract unchanged) and `webhooks/stripe/route.ts:37` (passes the fn —
  signature unchanged). Only additive branch.

### Behavioral reachability

- Price resolution: `resolvePlanFromPrice("price_max_month"/"price_max_year")`
  → "max" (billing.test.ts:55-56).
- Checkout payload: planId "max" → line_items price = max price both intervals,
  metadata `plan_id:"max"` (billing.test.ts:103-122).
- Webhook row write: checkout.session.completed with metadata.plan_id "max" →
  subscriptions row plan "max" (billing-core.test.ts:174-188).
- Legacy default path: no plan_id → "pro"; invalid ("enterprise") → "pro"
  (billing-core.test.ts:190-216).
- Route wiring: POST /api/billing/checkout `{planId:"max"}` →
  createCheckoutSession called with planId "max" (billing-routes.test.ts:272-286);
  PATCH switch → 3-arg call (billing-routes.test.ts:213).

### Undefined-env handling (risk hypothesis 3)

- `resolvePlanFromPrice`: `priceId === env.stripePriceMax` with undefined env →
  false → null (mirrors pro exactly).
- `createCheckoutSession`/`switchSubscriptionInterval`: unset max env → price
  undefined → `BillingNotConfiguredError` (guard preserved for all branches;
  existing "gooit BillingNotConfiguredError als de jaarlijkse price ontbreekt"
  test still passes).

### Test integrity

- Fail-before evidence (run-implementer-1.log): production files reverted to
  HEAD, 5 tests failed / 42 passed (billing-core max-checkout; billing-routes
  PATCH switch; billing.test resolvePlanFromPrice, checkout-max,
  switch-max). Restore confirmed: current diff == implementation, 47/47 green.
- No existing test weakened/removed/skipped. Legacy-default + invalid-plan_id +
  checkout-POST-max tests are contract locks that pass on old code by design
  (explicitly documented by implementer) — the real new behavior (price
  resolution, checkout payload, switch pricing, webhook row) is covered by
  fail-before assertions.
- No code special-cases test inputs; price fixture ids (`price_max_month`,
  `price_max_year`) are parallel to pro's existing fixture pattern.

### Shortcuts / reuse / architecture

- No stubs, TODOs, dead code, or hard-coded values beyond the prescribed
  legacy "pro" default. Added 2-line Dutch comment matches house style.
- Reuse: `planIdSchema` from shared reused (not re-declared); price-pair
  branching extends the existing canonical functions; the small ternary
  duplication between checkout and switch mirrors the pre-existing pro pattern
  (both already contained it) and is what the construction map prescribes.
- Conventions preserved: env style, zod-safeParse boundary, comment language,
  billing route API shapes, injected-resolver contract.

### Defect ledger

- None task-relevant. Non-blocking spec note: verification command 1 in the
  task lists `apps/web/…` absolute-ish paths; vitest in this app is rooted at
  `apps/web` (include `lib/**/*.test.ts`), so app-relative paths are required.
  This affects the command string only, not the coverage.

VERDICT: PASS
