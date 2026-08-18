# Implementer Report — phase-2-task-A-plans-max-3b8a

## Decision Packet

- **Role / Task ID:** IMPLEMENTER — phase-2-task-A-plans-max-3b8a (shared billing contract)
- **Status:** COMPLETE — all acceptance criteria PASS
- **Changed paths (declared scope):** `packages/shared/src/plans.ts` (modify),
  `packages/shared/src/__tests__/plans.test.ts` (new)
- **Read-only scope tracked:** `packages/shared/src/index.ts` (stayed byte-identical to
  scope-baseline hash `D9F5D3E3...` — verified via hash compare)
- **Criteria summary:** all 5 acceptance criteria PASS (per-criterion evidence below).
- **Verification summary:** `@scanpal/shared test` 568/568 green (39 files, incl. new
  plans.test.ts 11 tests); shared+web typecheck green; root `pnpm typecheck` green
  (8 packages); `pnpm lint` green; scope-baseline hash compare shows ONLY plans.ts
  changed among baseline files; no existing test modified.
- **Scope/preservation result:** PASS. free/pro existing values identical; index.ts
  byte-identical; only plans.ts + new plans.test.ts within scope changed.
- **Major-log ids:** none added (no major defect/consequential decision beyond the
  already-recorded MFL-20260818-010, whose numbers were implemented as-is).
- **Unresolved risks/blockers:** none.
- **Evidence paths:** this report; scope-baseline.json in the same directory;
  `packages/shared/src/plans.ts`; `packages/shared/src/__tests__/plans.test.ts`.
- **FAST-PATH ELIGIBLE: YES** — small additive contract change, fully verified.

---

## Detailed Evidence

### Verified facts (before change)

- `plans.ts` structure confirmed against the supplied construction map:
  - `planIdSchema = z.enum(["free","pro"])` at :3 (was)
  - `Plan` type :14-39 (seats/white_label now added to features)
  - `plans.free`: priceCents 0, credits 5, maxMembers 3, apiRatePerMinute 60,
    maxWebhooks 1, features all false
  - `plans.pro`: priceCents 2900, annualPriceCents 29000, credits 500, maxMembers 10,
    apiRatePerMinute 120, maxWebhooks 3, features all true
  - `planList` :97 (was :61), `publicPlanSchema` :99 (was :63), `subscriptionSchema`
    uses `planIdSchema` at :123 (updates automatically)
- `packages/shared/src/index.ts` re-exports `./plans` at :106 — no change needed.
- Risk hypothesis 1 resolved: pro DOES have `annualPriceCents` (29000), so the
  multiply branch applies: max annual = 116000.
- No pre-existing `plans.test.ts` exists (glob `packages/shared/src/__tests__/plans*`
  → no files), so a new test file is created per the task.

### Changes written

1. `planIdSchema` → `z.enum(["free", "pro", "max"])` (plans.ts:3).
2. `Plan["features"]` gained `seats: number | null` + `white_label: boolean`
   (plans.ts:34-37), with plan 64 comment references.
3. `plans.free` features: added `seats: null, white_label: false`; all other values
   unchanged (plans.ts:50-57).
4. `plans.pro` features: added `seats: null, white_label: false`; all other values
   unchanged (plans.ts:68-75).
5. `plans.max` added (plans.ts:77-94), field order matching pro:
   - id "max", name "Max" (capitalized like Free/Pro)
   - priceCents 11600 (= pro 2900 × 4), annualPriceCents 116000 (= pro 29000 × 4)
   - creditsPerPeriod 2000, maxMembers 3, apiRatePerMinute 240, maxWebhooks 3 (= pro)
   - features all true + seats 3 + white_label true
6. `planList = [plans.free, plans.pro, plans.max]` (plans.ts:97).
7. `publicPlanSchema.features` gained `seats: z.number().int().positive().nullable()`
   + `white_label: z.boolean()` (plans.ts:113-114).
8. New test `packages/shared/src/__tests__/plans.test.ts` — 11 tests: planIdSchema
   parse (free/pro/max + reject unknown), plans.max shape/limits/prices/features,
   free/pro seats null + white_label false + untouched existing values, planList
   length 3 + order, publicPlanSchema parses max/free/pro shapes.

### Consumer trace

Predicate: search for `planList|publicPlanSchema|planIdSchema` across `packages/*`
and `apps/*` (ripgrep, full-tree, no include filter) plus `plans\.(free|pro|max)|
planList|from "@scanpal/shared"` across all `*.test.ts`.

- `packages/shared/src/billing.ts:2,10,49` — uses `planIdSchema` for checkout
  `planId` and subscription-update `plan`; accepting "max" is the intended contract
  extension, no breakage.
- `apps/web/app/pricing/page.tsx:2,63` — renders `planList` via PricingCards; will
  render a third (Max) card. Not broken; pricing UI is task E (expected adaptation).
- `apps/web/app/api/plans/route.ts:2,8` — `planList.map((p) => publicPlanSchema.parse(p))`.
  publicPlanSchema now mirrors the new feature fields, so all three plans parse.
  Not broken.
- No test asserts `planList.length === 2` or plan shape beyond free/pro planId values.
  `packages/shared/src/__tests__/billing.test.ts` uses only `planId: "pro"/"free"` and
  `plan: "pro"/"free"` — still valid with max added. No existing test breaks.

### Verification (real output)

1. `pnpm --filter @scanpal/shared test` → **39 files, 568 tests passed** (incl.
   `plans.test.ts` 11 tests). Duration 5.42s.
2. `pnpm --filter @scanpal/shared typecheck` → clean exit.
3. `pnpm --filter @scanpal/shared --filter @scanpal/web typecheck` → both Done.
4. `pnpm typecheck` (root, `pnpm -r typecheck`, 8 packages) → all Done.
5. `pnpm lint` → clean exit (0).
6. Scope-baseline SHA-256 compare: **exactly one mismatch** —
   `packages/shared/src/plans.ts` (expected, the declared modification:
   `AA835C05…` → `D84A5E70…`). Every other baseline file, incl. `index.ts`
   (`D9F5D3E3…`) and all 38 pre-existing test files, byte-identical.
7. `git diff -- packages/shared/src/plans.ts` reviewed — diff matches the construction
   map exactly (42 insertions, 4 deletions; no reordering of untouched fields).
8. `git status --porcelain -- packages/shared` — plans.ts modified + plans.test.ts added
   by this task; all other entries (AGENTS.md, check-catalog.ts, findings.ts, index.ts,
   scans.ts, crux/mcp-tools/report-tokens/workspaces/branding files, and the other
   untracked tests) are pre-existing baseline changes from earlier phases, untouched.

### Acceptance criteria verdict

| # | Criterion | Result |
|---|---|---|
| 1 | planIdSchema accepts free/pro/max; plans.max exists with seats 3, white_label true, maxMembers 3, creditsPerPeriod 2000, apiRatePerMinute 240, maxWebhooks 3 (= pro), priceCents 11600 / annual 116000 (= 4× pro) | **PASS** |
| 2 | plans.free/pro unchanged in existing values; both gain seats null + white_label false | **PASS** (hash/diff evidence) |
| 3 | planList = [free, pro, max]; publicPlanSchema features include seats (number\|null) + white_label (boolean), parses max shape | **PASS** |
| 4 | New test passes; shared suite green; typecheck (root + shared) + lint pass | **PASS** |
| 5 | No file outside declared scope modified; no existing test modified (git status + baseline hash compare) | **PASS** |

### Deviations

None. (pro had annualPriceCents, so the conditional in the map resolved to the
multiply branch; numbers reported above.)

### Collateral impact

None broken. Two forward-looking consumers — `apps/web/app/pricing/page.tsx`
(renders a third card) and `apps/web/app/api/plans/route.ts` (parses all three) —
will intentionally be adapted by phase-2 tasks B/E; both remain functional today.
