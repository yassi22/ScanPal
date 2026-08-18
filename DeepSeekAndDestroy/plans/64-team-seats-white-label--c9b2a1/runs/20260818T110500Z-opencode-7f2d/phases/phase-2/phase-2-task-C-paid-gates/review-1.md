# Review 1 — phase-2-task-C-paid-gates (independent, Sonnet 5, round 1)

## Decision Packet

| Field | Value |
|---|---|
| Reviewer role | Independent reviewer, round 1. Did not implement. All evidence below re-derived from source files, git diff, and my own command runs — not copied from the implementer report. |
| Scope under review | Unit C of billing discovery (MFL-20260818-008): add `isPaidPlan` helper to `packages/shared/src/plans.ts`, broaden the 8 enumerated plan-identity gates from pro-only to paid-plan, rename `BillingManager` `isPro`→`isPaid`, TDD coverage. |
| Verdict | **PASS** |
| Scope/preservation | Clean. Content-hash compare (`scope_snapshot.py compare`) shows exactly the 13 baseline-tracked files from the declared 14-file inventory changed, plus 3 DSD run-level framework files (`HANDOVER.md`, `state.json`, this task's own `task.md`) which are orchestrator bookkeeping, not project source, and out of this review's scope per the brief. `git status --porcelain` diffed against the implementer's own captured pre-task baseline (`scope-baseline.txt`) shows exactly 12 new lines — all inside `apps/web`, all files already in the 14-file inventory. `invites-core.ts` and `pricing-cards.tsx` (task D/E) are byte-identical (confirmed by hash compare showing them in the `unchanged` list) and contain zero occurrences of `isPaidPlan` (grep). |
| Gate correctness | All 8 sites verified directly against `git diff` (ground truth, not the implementer's claims). Every `plan.id !== "pro"` → `!isPaidPlan(plan.id)` and every `plan.id === "pro"` → `isPaidPlan(plan.id)`. No inverted `!` anywhere. Direction preserved: free still blocked, pro still allowed, max now allowed. |
| Upsell / feature gates | `upsell: { plan: "pro" }` byte-identical in all 4 API routes (grep + diff). `plan.features.*` gates (`githubEnabled`, `activeTestsEnabled`) in `sites/page.tsx` untouched — verified by direct file read. |
| TDD reality | Re-derived independently: the 4 new/extended route test files (`threats-route.test.ts`, `threats-events-route.test.ts`, `site-honeypot-route.test.ts`, new `site-schedule-route.test.ts`) import the real route handlers and mock only external deps (`@/lib/db`, `@/lib/credits`, `@/lib/supabase/server`, `@/lib/scans-core`) — they never mock `@scanpal/shared` or `isPaidPlan`. Combined with the git diff showing the pre-image gate was literally `if (plan.id !== "pro")`, a max-plan test run against that pre-image would 403 (real behavioral failure), not a compile error. The shared-package `isPaidPlan` unit test's fail-before (`TypeError: isPaidPlan is not a function`) is correctly self-labeled by the implementer as an import-shape red, distinct from the route tests' behavioral red — this matches risk hypothesis #2 and it is **not** a case of that failure mode; the route tests are genuinely behavioral. |
| Verification | All 6 required commands re-run by me from repo root, real output, all green, counts match the implementer's report exactly (39/39 shared test files, 571/571 shared tests; 60/60 web test files, 588/588 web tests; both typechecks clean; both lints clean). |
| Unresolved findings | None. |
| Fast-path eligible | YES |

---

## Evidence log

### 1. Task/spec alignment
Read `task.md`, `implementer-report.md`, `changed-paths-inventory.txt`, `scope-baseline.json`/`.txt`. The DECIDED helper text (`export const isPaidPlan = (id: PlanId): boolean => id !== "free";`) matches `packages/shared/src/plans.ts:100` verbatim.

### 2. Scope/preservation — content-hash compare
```
python scope_snapshot.py compare --root . --baseline .../scope-baseline.json
→ Compared 247 paths; 16 changed.
```
`changed` = 16 entries:
- 13 match the declared 14-file inventory exactly (all `apps/web/*` + `packages/shared/src/plans.ts` + `packages/shared/src/__tests__/plans.test.ts`).
- 3 are DSD run-framework files: `HANDOVER.md`, `state.json`, and this task's own `task.md` (grew 4431→5629 bytes between baseline capture and now — orchestrator-appended context, not implementer-edited project source; out of this task's project-code scope per the review brief's own instruction to not flag DSD-framework/orchestrator state).
- The 14th inventory file (`apps/web/lib/__tests__/site-schedule-route.test.ts`, a **new** file) is correctly absent from `changed`/`unchanged` because the baseline snapshot only tracks 247 pre-existing paths and this file didn't exist yet — confirmed separately via git status below.
- `invites-core.ts` and `pricing-cards.tsx` appear in `unchanged` (byte-identical hash) — direct proof of no task D/E collision.

### 3. Scope/preservation — git status cross-check
```
git status --porcelain | sort  vs.  scope-baseline.txt (implementer's captured pre-task snapshot)
```
`comm -13` (lines only in current, i.e. new since baseline) = exactly 12 lines: the 11 `M` entries for the modified `apps/web` files + 1 `??` for the new `site-schedule-route.test.ts`. `comm -23` (lines dropped since baseline) = empty — nothing reverted or deleted. `plans.ts` and `plans.test.ts` were already `M`/`??` in the baseline (pre-existing from Unit A/B), and their further content change is independently confirmed by the hash compare in §2 and by `pnpm --filter shared test` passing with the 3 new `isPaidPlan` assertions.

`apps/web/lib/__tests__/sites-get-route.test.ts` (untracked) was already `??` in the baseline snapshot — pre-existing, not this task's scope creep (verified by grep in `scope-baseline.txt`).

### 4. Gate-by-gate verification (ground truth: `git diff`)
Ran `git diff` on all 8 gate files. Every hunk:
- `packages/shared/src/plans.ts`: `+export const isPaidPlan = (id: PlanId): boolean => id !== "free";` (plus unrelated prior max-plan additions from Unit A already in the diff base — not this task's concern).
- `billing/page.tsx`: `const isPro = plan.id === "pro"` → `const isPaid = isPaidPlan(plan.id)`; all 3 downstream usages (`isPro`→`isPaid`) renamed consistently; Dutch copy text at :66-69 unchanged (only the identifier changed).
- `sites/page.tsx`: `schedulingEnabled={plan.id === "pro"}` → `schedulingEnabled={isPaidPlan(plan.id)}`; `githubEnabled`/`activeTestsEnabled` (feature gates) untouched.
- `threats/page.tsx`: `if (plan.id !== "pro")` → `if (!isPaidPlan(plan.id))`.
- `sites/[id]/honeypot/route.ts`: `if (plan.id !== "pro")` → `if (!isPaidPlan(plan.id))`; `upsell: { plan: "pro" }` untouched.
- `sites/[id]/schedule/route.ts`: same pattern; `upsell: { plan: "pro" }` untouched.
- `api/threats/events/route.ts`: same pattern; `upsell: { plan: "pro" }` untouched.
- `api/threats/route.ts`: same pattern; `upsell: { plan: "pro" }` untouched.
- `components/billing-manager.tsx`: `Props.isPro`→`Props.isPaid`; `isProActive`→`isPaidActive`; JSX guard renamed consistently.

No `!` was added or dropped in a way that changes semantics — `!== "pro"` (block if not pro) and `!isPaidPlan(...)` (block if not paid) are logically equivalent in the intended direction (broadening pro-only to paid-only), and `=== "pro"`/`isPaidPlan(...)` likewise. **Risk hypothesis #1 disproven.**

Repo-wide grep for `isPaidPlan` (apps + packages, excluding node_modules): exactly 7 call sites + 1 definition + test-file references. No occurrence in `invites-core.ts` or `pricing-cards.tsx`.

### 5. TDD reality check (ground truth: test file contents + diff)
Read `apps/web/lib/__tests__/site-schedule-route.test.ts` (new) in full: imports the real `PATCH` handler from `@/app/api/sites/[id]/schedule/route`, mocks only `@/lib/supabase/server`, `@/lib/db`, `@/lib/credits`, `@/lib/scans-core` — never mocks `@scanpal/shared`/`isPaidPlan`. Contains free→403+upsell, pro→200, and max→200 (`"staat het Max-plan toe door de gate (voorheen 403 op plan-identiteit)"`) cases, all asserting on the real route's HTTP status and `setSiteScheduleMock` call args. Same pattern confirmed in the 3 extended test files (`threats-route.test.ts`, `threats-events-route.test.ts`, `site-honeypot-route.test.ts`) via grep — each has a free-403 case (preserved), a pro-200 case (preserved), and a new max-200 case, none of the test files import or mock `isPaidPlan`.

Since the pre-image of the route code (per `git diff`) was `if (plan.id !== "pro")`, a max-plan request against that pre-image genuinely returns 403 — the reported fail-before (`AssertionError: expected 403 to be 200`) is a real behavioral failure, not an import/compile error. The shared-package `TypeError: isPaidPlan is not a function` fail-before is correctly distinguished by the implementer as the necessary shape for a not-yet-exported symbol, and is a separate, non-behavioral check (a pure unit-value assertion), not one of the "route gates on max" claims. **Risk hypothesis #2 disproven** — the implementer's own report already flags and correctly characterizes this distinction, and my independent read of the test/diff confirms it.

### 6. Independent full verification run (repo root)
```
$ pnpm --filter shared typecheck && pnpm --filter shared test
  tsc --noEmit → exit 0, clean
  Test Files  39 passed (39) | Tests  571 passed (571)

$ pnpm --filter web typecheck
  tsc --noEmit → exit 0, clean

$ pnpm --filter web test
  Test Files  60 passed (60) | Tests  588 passed (588)
  (console.error lines visible in output are from tests that intentionally exercise 500-error paths — not failures; summary line confirms 60/60, 588/588)

$ pnpm --filter web lint
  eslint → exit 0, clean

$ pnpm typecheck
  all 8 workspace projects report "Done", exit 0

$ pnpm lint
  delegates to web lint → exit 0, clean
```
All counts match the implementer's report exactly.

### 7. Test-infra gap disclosure sanity check
Implementer disclosed no `.tsx`/jsdom coverage exists for the 2 UI-only gates (`billing-manager.tsx`, `billing/page.tsx` copy branch) and the `sites/page.tsx` prop / `threats/page.tsx` page-level branch beyond what's covered by the 4 API-route tests. Confirmed via `apps/web/vitest.config.ts`: `environment: "node"`, `include: ["lib/**/*.test.ts"]` — no jsdom, no `.tsx` inclusion glob exists anywhere in the current test infra. This is a genuine, pre-existing infra limitation, not an implementer shortcut, and is out of this unit's scope to fix (discovery spec's test seams are `lib/**/*.test.ts`-shaped). Not a blocking finding.

### 8. Scope creep check (risk hypothesis #3)
- `apps/web/lib/invites-core.ts`: byte-identical (hash compare `unchanged` list); zero `isPaidPlan` occurrences (grep).
- `apps/web/components/pricing-cards.tsx`: byte-identical (hash compare `unchanged` list); zero `isPaidPlan` occurrences (grep).
- `billing/page.tsx` Dutch copy at :66-69: text strings unchanged in the diff hunk — only the driving identifier renamed, which is this unit's own required prop rename, not task E's copy change.
**Risk hypothesis #3 disproven.**

---

## Findings

None. Zero unresolved task-relevant findings.

---

VERDICT: PASS

FAST-PATH ELIGIBLE: YES
