# Implementer Report — phase-2-task-C-paid-gates

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Implementer (Sonnet 5) — `phase-2-task-C-paid-gates`, Unit C of billing discovery `phase-2-billing-discovery-6e0b` (MFL-20260818-008) |
| Status | **COMPLETE** — all 6 verification commands pass with real (non-mocked) output; TDD fail-before/pass-after captured for every new assertion |
| Changed paths (exact) | See `changed-paths-inventory.txt` in this dir. 14 source/test files: `packages/shared/src/plans.ts`, `packages/shared/src/__tests__/plans.test.ts`, `apps/web/app/(dashboard)/billing/page.tsx`, `apps/web/components/billing-manager.tsx`, `apps/web/app/api/threats/route.ts`, `apps/web/app/api/threats/events/route.ts`, `apps/web/app/api/sites/[id]/honeypot/route.ts`, `apps/web/app/api/sites/[id]/schedule/route.ts`, `apps/web/app/(dashboard)/threats/page.tsx`, `apps/web/app/(dashboard)/sites/page.tsx`, `apps/web/lib/__tests__/threats-route.test.ts`, `apps/web/lib/__tests__/threats-events-route.test.ts`, `apps/web/lib/__tests__/site-honeypot-route.test.ts`, and one **new** file `apps/web/lib/__tests__/site-schedule-route.test.ts` (no route test previously existed for the schedule route). Plus the two deliverable files themselves. |
| Criteria summary | Helper added verbatim per DECIDED text; barrel re-export verified (wildcard `export * from "./plans"` — no edit needed); all 8 enumerated gate expressions replaced with `isPaidPlan(plan.id)` / `!isPaidPlan(plan.id)`; `BillingManager` prop renamed `isPro`→`isPaid`, internal `isProActive`→`isPaidActive`; upsell payloads (`plan: "pro"`) untouched; no site outside the 8 touched. See §Evidence per gate below. |
| Verification summary | All 6 commands green, real counts below (§Verification). Repo-wide `pnpm typecheck` and `pnpm lint` also captured **before** any edit as a pre-change baseline (both clean) — see §Pre-change baseline. |
| Scope / preservation | No file outside the 14 listed was modified. `pricing-cards.tsx`, `invites-core.ts`, and billing-page copy text at :66-69 (task D/E territory) were never opened for editing — confirmed by post-hoc grep (see §Scope discipline verification). `plan.features.*` gates in `sites/page.tsx` (lines for `githubEnabled`, `activeTestsEnabled`) and `sites/[id]/page.tsx` were left untouched. |
| Fail-before/pass-after evidence | Captured to disk before touching any source: `pnpm --filter shared test -- plans.test.ts` failed with `TypeError: (0 , isPaidPlan) is not a function` (import-shape red, as expected for a not-yet-exported helper); `pnpm --filter web test -- lib/__tests__/threats-route.test.ts lib/__tests__/threats-events-route.test.ts lib/__tests__/site-honeypot-route.test.ts lib/__tests__/site-schedule-route.test.ts` failed 4/4 new max-plan assertions with `AssertionError: expected 403 to be 200` (genuine behavioral red — the route logic, not a typecheck error, produced the failure). After the gate edits, the identical test invocations pass 100%. Full transcripts quoted in §TDD evidence. |
| Unresolved risks | (1) No `.test.tsx` coverage exists anywhere in the repo (vitest `include: ["lib/**/*.test.ts"]`, `environment: "node"`) so the two React component/page gates (`billing/page.tsx` isPaid copy branch, `billing-manager.tsx` isPaidActive branch, `sites/page.tsx` `schedulingEnabled` prop, `threats/page.tsx` upsell branch) have **no dedicated automated test** proving the max-plan behavior at the component-render level — only the underlying API-route gates (4 of the 8 sites) got behavioral TDD coverage, plus the shared-package `isPaidPlan` unit assertions. This is a declared, intentional gap consistent with existing project test infrastructure, not an oversight — building jsdom/RTL infra for `.tsx` was out of this unit's scope and not called for by the discovery spec's test seams (§1.5 lists only `lib/**/*.test.ts`-style seams). (2) `billing-manager.tsx`'s `isPaid` prop is fed purely from the caller (`billing/page.tsx`); there is no independent test asserting a max-plan `BillingManager` renders portal/cancel controls, for the same jsdom-gap reason. |

---

## 1. Pre-change baseline (run BEFORE any edit)

```
pnpm typecheck   → exit 0, all 8 workspace projects "Done", no errors
pnpm lint        → exit 0, eslint clean
```
Both captured to scratchpad before any file was touched, confirming the pre-existing 68-path uncommitted baseline (plans 61/62/63 + phase-1/2) was already typecheck/lint clean, so any later failure would be attributable to this unit.

## 2. Gate-by-gate evidence (the 8 enumerated sites)

Verified by direct grep of the 8 files for `isPro`, `=== "pro"`, `!== "pro"` BEFORE editing — all 8 matched exactly the discovery spec's description, no additional plan-identity gates found in these files (no STOP condition triggered):

```
apps/web/app/(dashboard)/billing/page.tsx:35   const isPro = plan.id === "pro";
apps/web/components/billing-manager.tsx:17     isPro: boolean;
apps/web/components/billing-manager.tsx:21     export function BillingManager({ isOwner, isPro, ... })
apps/web/app/api/threats/route.ts:31            if (plan.id !== "pro") {
apps/web/app/api/threats/events/route.ts:32     if (plan.id !== "pro") {
apps/web/app/api/sites/[id]/honeypot/route.ts:36 if (plan.id !== "pro") {
apps/web/app/api/sites/[id]/schedule/route.ts:46 if (plan.id !== "pro") {
apps/web/app/(dashboard)/threats/page.tsx:41    if (plan.id !== "pro") {
apps/web/app/(dashboard)/sites/page.tsx:37      schedulingEnabled={plan.id === "pro"}
```

**Note on call-site count:** the helper `isPaidPlan(...)` itself is *called* at 7 of the 8 sites — site #2 (`billing-manager.tsx`) only receives the renamed boolean prop from its caller (site #1) and never calls the helper directly. This matches the task's own instruction ("`isPro` prop → `isPaid`... fed by `isPaidPlan(plan.id)`" — the feeding happens once, at the caller). Post-edit grep of the whole repo for `isPaidPlan` confirms exactly 7 call sites + 1 definition + tests, nowhere else:

```
apps/web/app/(dashboard)/billing/page.tsx:35    const isPaid = isPaidPlan(plan.id);
apps/web/app/(dashboard)/sites/page.tsx:38       schedulingEnabled={isPaidPlan(plan.id)}
apps/web/app/(dashboard)/threats/page.tsx:42     if (!isPaidPlan(plan.id)) {
apps/web/app/api/sites/[id]/honeypot/route.ts:36 if (!isPaidPlan(plan.id)) {
apps/web/app/api/sites/[id]/schedule/route.ts:46 if (!isPaidPlan(plan.id)) {
apps/web/app/api/threats/events/route.ts:32      if (!isPaidPlan(plan.id)) {
apps/web/app/api/threats/route.ts:31             if (!isPaidPlan(plan.id)) {
packages/shared/src/plans.ts:100                 export const isPaidPlan = (id) => id !== "free";  (definition)
packages/shared/src/__tests__/plans.test.ts       (unit assertions only)
```

Post-edit grep of the 8 files for the old `isPro`/`=== "pro"`/`!== "pro"` patterns returns **zero matches** — no stray gate left behind.

### 2.1 `packages/shared/src/plans.ts` (helper)
Added verbatim as DECIDED:
```ts
export const isPaidPlan = (id: PlanId): boolean => id !== "free";
```
Placed after `planList`. Barrel `packages/shared/src/index.ts:106` is `export * from "./plans";` — a wildcard re-export, so no barrel edit was needed; verified `isPaidPlan` is importable from `@scanpal/shared` (used successfully by 6 `apps/web` files + typecheck/lint pass).

### 2.2 `apps/web/app/(dashboard)/billing/page.tsx`
Renamed the single `isPro` variable to `isPaid = isPaidPlan(plan.id)` (import added: `import { plans, isPaidPlan } from "@scanpal/shared";`). The variable is used at 4 lines — definition (:35), the credits/members copy conditional (:66), the payment-method block guard (:70), and the `BillingManager` prop (:92, now `isPaid={isPaid}`). **The copy text itself is byte-identical** — only the identifier driving the conditional changed from `isPro` to `isPaid`; this is the rename task C calls for, not the copy change reserved for task E (task E's boundary is the Dutch *text* at :66-69, which is untouched).

### 2.3 `apps/web/components/billing-manager.tsx`
`Props.isPro` → `Props.isPaid`; destructured param renamed; internal derived flag `isProActive` → `isPaidActive` (3 occurrences: definition :88-89, and the JSX guard `{isPaidActive && (...)}` at :96 — this third occurrence was not explicitly enumerated in the discovery spec's ":88-89" but is the same identifier and had to move with the rename to remain internally consistent; verified by grep there is no leftover `isProActive`/`isPro` anywhere in the file).

### 2.4–2.7 API routes (threats, threats/events, honeypot, schedule)
Each: added `isPaidPlan` to the existing `@scanpal/shared` import, replaced `plan.id !== "pro"` with `!isPaidPlan(plan.id)`. Upsell payloads (`upsell: { plan: "pro" }`) and error copy left byte-identical in all four.

### 2.8 `apps/web/app/(dashboard)/threats/page.tsx`
Already had a type-only import from `@scanpal/shared` (`import type { ThreatRuleKey } from "@scanpal/shared";`); added a second, value-level import line `import { isPaidPlan } from "@scanpal/shared";` rather than merging into the type-only import (avoids accidentally converting the type-only import and matches existing file style of separate import statements). Replaced `plan.id !== "pro"` with `!isPaidPlan(plan.id)`.

### 2.9 `apps/web/app/(dashboard)/sites/page.tsx`
This file had **no** prior `@scanpal/shared` import — added `import { isPaidPlan } from "@scanpal/shared";`. Replaced `schedulingEnabled={plan.id === "pro"}` with `schedulingEnabled={isPaidPlan(plan.id)}`. The adjacent `githubEnabled={plan.features.github}` and `activeTestsEnabled={plan.features.activeTests}` props (feature-flag gates) on the same JSX element were left untouched, per the hard scope rule.

---

## 3. TDD evidence — fail-before / pass-after

### 3.1 Shared package: `isPaidPlan` unit assertions
Added to `packages/shared/src/__tests__/plans.test.ts` (import extended + new `describe("isPaidPlan (plan 64 stap 2, MFL-20260818-008)")` block with 3 `it`s: free→false, pro→true, max→true) **before** adding the helper to `plans.ts`.

**Fail-before** (`pnpm --filter shared test -- plans.test.ts`, run before touching `plans.ts`):
```
FAIL src/__tests__/plans.test.ts > isPaidPlan (...) > is false voor free
TypeError: (0 , isPaidPlan) is not a function
 ❯ src/__tests__/plans.test.ts:79:12

FAIL src/__tests__/plans.test.ts > isPaidPlan (...) > is true voor pro
TypeError: (0 , isPaidPlan) is not a function

FAIL src/__tests__/plans.test.ts > isPaidPlan (...) > is true voor max
TypeError: (0 , isPaidPlan) is not a function

 Test Files  1 failed | 38 passed (39)
      Tests  3 failed | 568 passed (571)
```
This is an import/export-shape failure (the named export did not exist yet), not a logic-assertion failure — flagged as such per instruction, since a true "red" on a not-yet-created export can only manifest this way.

**Pass-after** (`pnpm --filter shared typecheck && pnpm --filter shared test`, after adding the helper):
```
typecheck: tsc --noEmit → clean, no output, exit 0
test:      Test Files  39 passed (39)
           Tests       571 passed (571)
```
571 = 568 pre-existing + 3 new `isPaidPlan` assertions, all green. Zero regressions in the other 38 shared test files.

### 3.2 Web routes: max-plan behavioral coverage
Extended 3 existing route test files with a "Max-plan toegestaan" case, and wrote 1 new route test file (no test previously existed for the schedule route):

- `apps/web/lib/__tests__/threats-route.test.ts` — added case: `planMock` returns `{ id: "max" }` → expect `GET` returns 200 (was 403 pre-gate-change).
- `apps/web/lib/__tests__/threats-events-route.test.ts` — same pattern for `GET /api/threats/events`.
- `apps/web/lib/__tests__/site-honeypot-route.test.ts` — same pattern for `POST /api/sites/[id]/honeypot`.
- `apps/web/lib/__tests__/site-schedule-route.test.ts` (**new file**) — full route coverage modeled on `site-honeypot-route.test.ts` (401/404/400/free-403+upsell/pro-200/max-200/500), including the `frequency: "none"` short-circuit that skips the plan check entirely (pre-existing route behavior, documented not changed).

These tests assert only on HTTP status codes and response shape (`upsell`, `feature`) returned by the actual route handlers — they do not reference `isPaidPlan` at all, so they compile and fail *behaviorally* against the still-unmodified `plan.id !== "pro"` gates.

**Fail-before** (`pnpm --filter web test -- lib/__tests__/threats-route.test.ts lib/__tests__/threats-events-route.test.ts lib/__tests__/site-honeypot-route.test.ts lib/__tests__/site-schedule-route.test.ts`, run before editing any of the 7 app files):
```
FAIL lib/__tests__/site-schedule-route.test.ts > ... > staat het Max-plan toe door de gate (voorheen 403 op plan-identiteit)
AssertionError: expected 403 to be 200

FAIL lib/__tests__/threats-events-route.test.ts > ... > staat het Max-plan toe door de gate (voorheen 403 op plan-identiteit)
AssertionError: expected 403 to be 200

FAIL lib/__tests__/threats-route.test.ts > ... > staat het Max-plan toe door de gate (voorheen 403 op plan-identiteit)
AssertionError: expected 403 to be 200

(site-honeypot-route.test.ts max-case also failed identically)

 Test Files  4 failed | 56 passed (60)
      Tests  4 failed | 584 passed (588)
```
All 4 new assertions failed with the exact expected symptom (403 instead of 200) — genuine pre-fix behavioral red, zero regressions in the other 56 test files.

**Pass-after** (`pnpm --filter web test`, full suite, after all 7 app-file gate edits):
```
 Test Files  60 passed (60)
      Tests  588 passed (588)
```
Reconciling the counts: the fail-before checkpoint already had all 11 new test cases present (4 in the 3 extended files' new "max toegestaan" `it`s + 8 in the brand-new `site-schedule-route.test.ts`, of which 1 was the max-plan case and 7 were non-TDD baseline cases for 401/404/400/`frequency:"none"`/pro/500 that exercise unchanged code and were green from the start) — hence fail-before's `584 passed | 4 failed = 588 total`. True pre-existing count (before this unit touched anything) is `588 − 11 = 577`. After the gate edits, all 588 pass (the 4 that were failing now pass, the 7 that were already green stay green, the 577 pre-existing stay green). Zero regressions.

**Post-fix re-verification:** while drafting this report, self-review caught that one of the new baseline cases in `site-schedule-route.test.ts` ("staat Pro toe door de gate en zet het schema") asserted `body.schedule.scan_frequency === "daily"` against a `weekly` request — it only passed because the mock's canned return value hardcoded `"daily"`, so the assertion proved nothing about the route. Fixed to assert `setSiteScheduleMock` was called with `{ teamId: "team-1", siteId: SITE_ID, frequency: "weekly" }` instead (same shape as the max-plan case). Re-ran `pnpm --filter web test` after the fix: still `Test Files 60 passed (60)`, `Tests 588 passed (588)`.

---

## 4. Verification (all commands run from repo root, real output)

```
$ pnpm --filter shared typecheck && pnpm --filter shared test
  typecheck: exit 0, clean
  test:      Test Files 39 passed (39) | Tests 571 passed (571)

$ pnpm --filter web typecheck
  exit 0, clean (tsc --noEmit)

$ pnpm --filter web test
  Test Files 60 passed (60) | Tests 588 passed (588)

$ pnpm --filter web lint
  exit 0, eslint clean

$ pnpm typecheck
  exit 0, all 8 workspace projects ("packages/db", "packages/shared", "packages/mcp-server",
  "packages/notify", "packages/scan-core", "apps/scheduler", "apps/web", "apps/worker") report "Done"

$ pnpm lint
  exit 0, eslint clean (repo lint delegates to `pnpm --filter web lint`)
```

All 6 commands exit 0. No test file used the repo-relative path form warned against in the task spec (`lib/__tests__/...` app-relative form used throughout, e.g. `pnpm --filter web test -- lib/__tests__/threats-route.test.ts`).

**Final re-verification:** after the self-review fix in §3.2 (the vacuous-assertion correction), all 6 commands above were re-run in full one more time as a final pass — identical results (shared: 39/39 files, 571/571 tests; web typecheck: clean; web test: 60/60 files, 588/588 tests; web lint: clean; repo typecheck: all 8 projects "Done"; repo lint: clean). A closing grep of all 8 gate files for `isPro`/`=== "pro"`/`!== "pro"` returned zero matches (exit 1, no output) — confirming no stray plan-identity gate was left behind anywhere in scope.

---

## 5. Scope discipline verification

- `apps/web/lib/invites-core.ts` and `apps/web/components/pricing-cards.tsx` (task D/E territory) — **no Edit or Write tool call in this session ever targeted either file.** This is a stronger guarantee than a byte/line-count comparison: the tool-call log is the ground truth for what was touched, not a post-hoc grep.
- `apps/web/app/(dashboard)/billing/page.tsx` Dutch copy text at :66-69 — text strings unchanged; only the driving identifier (`isPro`→`isPaid`) changed, as required by this unit's own prop-rename instruction.
- `plan.features.*` (feature-flag) gates — left untouched everywhere they co-occur with plan-identity gates in the same file (`sites/page.tsx` :36/:38 `githubEnabled`/`activeTestsEnabled`).
- No migrations touched. No file outside `apps/web` and `packages/shared` touched.
- `isPaidPlan` usage confirmed (repo-wide grep) to exist at exactly: 1 definition, 7 gate call sites, plus test files — never used anywhere else, per the hard scope rule ("Do NOT use `isPaidPlan` anywhere outside the 8 sites").

### 5.1 `git status --porcelain` diff against `scope-baseline.txt` (proof, not just claim)

The repo IS a git repo (contrary to this session's environment header) and `scope-baseline.txt` in this task dir is itself a captured `git status --porcelain` snapshot of the accepted 68-path pre-existing baseline. Re-running `git status --porcelain` now and diffing (sorted) against that baseline shows **exactly 12 new lines**, all inside `apps/web`, all in files this report already lists — nothing else:

```
diff scope-baseline.txt(68 entries, sorted) vs current `git status --porcelain` (80 entries, sorted):

>  M apps/web/app/(dashboard)/billing/page.tsx
>  M apps/web/app/(dashboard)/sites/page.tsx
>  M apps/web/app/(dashboard)/threats/page.tsx
>  M apps/web/app/api/sites/[id]/honeypot/route.ts
>  M apps/web/app/api/sites/[id]/schedule/route.ts
>  M apps/web/app/api/threats/events/route.ts
>  M apps/web/app/api/threats/route.ts
>  M apps/web/components/billing-manager.tsx
>  M apps/web/lib/__tests__/site-honeypot-route.test.ts
>  M apps/web/lib/__tests__/threats-events-route.test.ts
>  M apps/web/lib/__tests__/threats-route.test.ts
>  ?? apps/web/lib/__tests__/site-schedule-route.test.ts
```

12 new entries = my 14-file inventory minus the 2 files (`packages/shared/src/plans.ts`, `packages/shared/src/__tests__/plans.test.ts`) that were **already** `M`/`??` in the accepted baseline (pre-existing from Unit A) — those two files' further edits don't add new porcelain lines since git status is a per-file flag, not a diff-size counter, but their content changes are independently verified by the `pnpm --filter shared test` pass-after run in §3.1 (571 passing, including the 3 new `isPaidPlan` assertions). No line outside this set of 12 (+2 pre-existing) appears anywhere in the diff — zero stray files touched. The two deliverable files (`changed-paths-inventory.txt`, `implementer-report.md`) don't surface individually because the whole `DeepSeekAndDestroy/` directory was already untracked (`?? DeepSeekAndDestroy/`) in the accepted baseline.

---

## 6. Files NOT touched (explicitly checked, in-scope-adjacent but out of bounds)
- `apps/web/lib/invites-core.ts`
- `apps/web/components/pricing-cards.tsx`
- `apps/web/app/(dashboard)/billing/page.tsx` lines 66-69 (copy text only — variable identifier at those lines did change as part of the required rename, text did not)
- `apps/web/app/(dashboard)/sites/[id]/page.tsx` (onDeploy feature-flag gate — different file, different gate type, not in the 8)
- Any migration file
- `packages/scan-core/src/credits.ts`, `apps/web/lib/credits.ts` (re-export only, `getPlanForTeam` — used as-is by all 4 routes, not modified)

---

**DONE — Task phase-2-task-C-paid-gates complete. All 8 plan-identity gates broadened to `isPaidPlan(...)` (7 call sites + 1 prop-fed BillingManager), `BillingManager` prop renamed `isPro`→`isPaid`, upsell targets left at `"pro"`, TDD fail-before/pass-after captured for the shared helper and 4 of the 8 gates at the API-route level (jsdom-free component gates declared as a coverage gap, not an oversight — see Unresolved risks). All 6 required verification commands pass with real green output; report at `DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-2/phase-2-task-C-paid-gates/implementer-report.md`.**
