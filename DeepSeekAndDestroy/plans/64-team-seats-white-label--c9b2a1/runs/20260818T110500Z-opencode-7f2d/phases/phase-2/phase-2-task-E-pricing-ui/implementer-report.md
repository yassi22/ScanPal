# Implementer Report — phase-2-task-E-pricing-ui

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Implementer (Sonnet 5) — `phase-2-task-E-pricing-ui`, Unit E of the billing discovery spec (plan 64-team-seats-white-label, step 2) |
| Status | **COMPLETE** |
| Changed paths | `apps/web/components/pricing-cards.tsx` (modified), `apps/web/app/(dashboard)/billing/page.tsx` (modified), `apps/web/lib/__tests__/plans-route.test.ts` (added). Full detail in `changed-paths-inventory.txt`. |
| Criteria per item | See "Criteria checklist" below — all task.md bullet points addressed. |
| Verification | typecheck/test/lint all green, real counts pasted below (5 commands, run twice — once after initial change, once after the seats-row fix below). |
| Scope / preservation | Diffed against the task-dir `scope-baseline.json` (captured after task-D acceptance). Only the 2 files above were edited; no other file touched. `packages/shared/src/plans.ts`, task-C gate files (`billing-manager.tsx`, threats/honeypot/schedule routes, `sites/page.tsx`), and task-D invite files were read-only in this session — confirmed via `git diff --stat` scoped to exactly these two paths (23 insertions / 12 deletions, 2 files). |
| Test-infra limitation | Stated honestly below — no component-render test added; backed by `apps/web/vitest.config.ts` contents, not by inherited claims. |
| Unresolved risks | (1) Pro(maxMembers=10) vs Max(seats=3) asymmetry is visible on the public pricing page — inherited from accepted plan data, not introduced by this task. (2) No visual/browser check was performed (no jsdom/RTL in this repo); the grid/CTA changes are verified by reading the JSX and confirming the mount point's container width, not by rendering. |

---

## Criteria checklist (task.md, line by line)

### `apps/web/components/pricing-cards.tsx`

| Task requirement | Done | Evidence |
|---|---|---|
| Grid `md:grid-cols-2` → 3 columns | Yes | `grid gap-6 md:grid-cols-3` (was `md:grid-cols-2`) |
| Genericize `plan.id === "pro"` highlight | Yes | `const isFeatured = plan.id === "max"` computed once per card, used for both the card border (`border-brand/40 bg-brand/5`) and the unauthenticated-CTA button style. Chose "max is the highlighted tier" (one of the two options the task explicitly offered) rather than highlighting pro+max, to keep a single visual "featured" state. |
| Genericize register/CTA conditionals | Yes | The `!signedIn` CTA button className now branches on `isFeatured` instead of `plan.id === "pro"`. The `plan.id === "free"` branches (label text, dashboard-vs-checkout branch) were already generic — free is a real, permanent distinction (no checkout for it), not a hardcoded pro/max special case, so left as-is. |
| Genericize busy/label logic | Yes | `busy === "pro" ? "Bezig…" : "Upgrade naar Pro"` → `` busy === plan.id ? "Bezig…" : `Upgrade naar ${plan.name}` ``. Now correct for pro and max independently (each card's own busy state, each card's own name in the label). |
| Optional: surface `features.seats` / `features.white_label` | Yes | Existing "Maximaal {maxMembers} teamleden" row now reads `{plan.features.seats} betaalde seats` when `features.seats !== null` (max only), otherwise unchanged for free/pro. Added a new white_label row (✓/✕ pattern matching the existing uptime/github rows). Existing uptime/github rows are untouched. |
| No pro→max seat-upsell affordance | Yes | The checkout button for every non-free, non-current card just says "Upgrade naar {plan.name}" and posts `{planId: plan.id}` — there is no comparison language, no "more seats" framing, no arrow/upgrade-path UI between pro and max cards. Each paid card is an independent purchase target. |

**Design note on the seats-row fix**: my first pass *added* a seats row alongside the existing "Maximaal N teamleden" row, which put two people-count lines on the Max card (both reading "3") while Pro showed "Maximaal 10 teamleden" directly above it on the page — reading as a downgrade. Caught this before finalizing and changed it to a single row that shows seats-if-present, else maxMembers, so each card shows exactly one people-count line. This keeps the "keep existing uptime/github rows" instruction (those are untouched) while not literally preserving the maxMembers row's wording for max — the task said "surface... as feature rows," not "add without removing," and duplicate/contradictory copy on a customer-facing pricing page is a correctness issue, not scope creep.

### `apps/web/app/(dashboard)/billing/page.tsx`

| Task requirement | Done | Evidence |
|---|---|---|
| Make the `isPaid` copy branch (~:66-69) plan-aware | Yes | Added a `plan.id === "max"` branch above the existing `isPaid` ternary: shows `{creditsPerPeriod} scans per {interval} · {seats} betaalde seats · white-label branding`. Pro (isPaid, not max) falls through unchanged to the original "· {maxMembers} teamleden · uptime & GitHub-scans" string. Free (not isPaid) unchanged. |
| Do NOT alter isPaid/BillingManager gate logic | Yes | `const isPaid = isPaidPlan(plan.id)` (line 35) and the `<BillingManager isOwner isPaid subscription>` props (lines 90-94) are byte-identical to before my edit — only the JSX text inside the `<p>` at ~line 66 was touched. Confirmed via `git diff` — the diff hunk is contained entirely within that one `<p>` block. |

### `apps/web/app/(dashboard)/sites/page.tsx` / `sites/[id]/page.tsx`

Verified, not changed, per task instruction ("change them only if genuinely needed"):
- `sites/page.tsx` already computes `schedulingEnabled={isPaidPlan(plan.id)}` and passes `plan.features.github` / `plan.features.activeTests` directly (task-C's work) — these already broaden to max automatically since `isPaidPlan` and `plan.features.*` are plan-identity-agnostic reads. No max-specific copy exists on this page to make plan-aware.
- `sites/[id]/page.tsx` passes `plan.features.onDeploy` to `DeployWebhookCard` — same reasoning, no plan-identity conditional to touch.
- No genuine need found for a change; left untouched.

### Pricing page mount point (verified per advisor review, not in original task checklist)

`apps/web/app/pricing/page.tsx:63` is the only call site of `<PricingCards>` in the repo (confirmed via grep — 2 files match "PricingCards": the component itself and this page). Its container is `<main className="mx-auto w-full max-w-5xl ...">` (1024px). With `gap-6` (2 × 24px = 48px) and 3 equal columns, each card gets ≈325px — a reasonable card width, not squashed. No parent-container change was needed for the 3-column grid to render sensibly.

---

## Tests

Added `apps/web/lib/__tests__/plans-route.test.ts`:
```ts
describe("GET /api/plans", () => {
  it("returns all 3 plans including max with seats/white_label features", ...)
});
```
Asserts: `body.plans` has length 3, ids are exactly `["free","pro","max"]`, max has `name: "Max"`, `features.seats === 3`, `features.white_label === true`; free and pro both have `features.seats === null` and `features.white_label === false`.

**Honesty note on this test's red/green status**: discovery-spec §4 states new behavior tests must fail before the change and pass after. This test does **not** meet that bar — `planList` already contained all 3 plans with the `seats`/`white_label` fields before I touched anything (that's task-A's accepted work, confirmed by reading `packages/shared/src/plans.ts` at the start of this session — `planList = [plans.free, plans.pro, plans.max]` was already present). This test is a **regression guard** on the public `/api/plans` contract surfacing the max plan and its features correctly — not a red/green test of task-E's UI wiring, because task-E's UI wiring (pricing-cards.tsx, billing/page.tsx) has no dedicated test at all (see next section). I'm stating this plainly rather than letting the report imply otherwise.

**Component-render test infeasibility — stated explicitly, not inherited**: I checked `apps/web/vitest.config.ts` myself rather than relying on the discovery-spec's claim:
```ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  ...
});
```
Two independent facts confirm no `.tsx` component test is possible without adding infra: (1) `environment: "node"` — no DOM/jsdom available for React rendering; (2) `include: ["lib/**/*.test.ts"]` — the test runner doesn't even glob `.tsx` files or anything outside `lib/`, so a component test file wouldn't be picked up even if written. Adding jsdom + React Testing Library + a config change to make `.tsx` files under `components/` and `app/` discoverable is out of scope for this presentational-wiring task. Coverage for `pricing-cards.tsx` and `billing/page.tsx` is therefore: TypeScript typecheck (JSX prop/type correctness) + ESLint + the `/api/plans` route test (verifies the data these components consume is correct) + my own manual read-through of the diff. This is a real gap — the actual rendered grid/CTA/copy behavior is unverified by automation.

---

## Verification (real output, run from repo root)

All 5 commands were re-run after the seats-row fix (the numbers below are from that final run):

### `pnpm --filter web typecheck`
```
> @scanpal/web@0.1.0 typecheck C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web
> tsc --noEmit
```
Exit clean, no errors printed.

### `pnpm --filter web test`
```
 Test Files  63 passed (63)
      Tests  601 passed (601)
   Start at  15:14:04
   Duration  11.84s (transform 8.40s, setup 0ms, collect 88.12s, tests 4.04s, environment 25ms, prepare 29.33s)
```
Includes the new `lib/__tests__/plans-route.test.ts (1 test)` passing. All 62 pre-existing test files still pass unchanged (601 total tests, up from 600 before this task's addition).

### `pnpm --filter web lint`
```
> @scanpal/web@0.1.0 lint C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web
> eslint
```
Exit clean, no lint errors/warnings printed.

### `pnpm typecheck` (repo-wide, 8 packages)
```
Scope: 8 of 9 workspace projects
packages/db typecheck: Done
packages/shared typecheck: Done
packages/mcp-server typecheck: Done
packages/notify typecheck: Done
packages/scan-core typecheck: Done
apps/scheduler typecheck: Done
apps/web typecheck: Done
apps/worker typecheck: Done
```
All 8 packages/apps typecheck clean.

### `pnpm lint` (repo-wide)
```
> scanpal@0.1.0 lint
> pnpm --filter web lint
> @scanpal/web@0.1.0 lint
> eslint
```
Exit clean (repo-level lint delegates to `apps/web` lint only — confirmed this is the only lint script defined at the root, no other package defines a `lint` script).

---

## Scope / preservation vs baseline

Confirmed via `git diff --stat -- apps/web/components/pricing-cards.tsx "apps/web/app/(dashboard)/billing/page.tsx"`:
```
 apps/web/app/(dashboard)/billing/page.tsx | 16 +++++++++-------
 apps/web/components/pricing-cards.tsx     | 19 ++++++++++++++-----
 2 files changed, 23 insertions(+), 12 deletions(-)
```
This diff is scoped to exactly the two files I edited, and matches the two files listed in `changed-paths-inventory.txt`. I did not run any `git add`/commit; the repo has a large pre-existing set of uncommitted changes from tasks A–D (visible in `git status`), all of which I left untouched — I only used the Edit tool on `pricing-cards.tsx` (3 edits) and `billing/page.tsx` (1 edit), and the Write tool to create the new test file. No DeepSeekAndDestroy file was touched except this report and the changed-paths inventory, per instructions.

`packages/shared/src/plans.ts` (plan data, `isPaidPlan`, `planList`) was read but not modified — confirmed already containing the 3-plan `max` entry, `features.seats`/`features.white_label`, and `isPaidPlan` export before this session started (task-A/task-C's accepted work).

---

## Evidence log

1. Read `task.md` and `discovery-spec.md` in full before starting.
2. Read `packages/shared/src/plans.ts` — confirmed `max` plan, `planList` (3 entries), `isPaidPlan` already present (task-A/C accepted baseline).
3. Read `apps/web/components/pricing-cards.tsx`, `apps/web/app/(dashboard)/billing/page.tsx`, `apps/web/app/(dashboard)/sites/page.tsx`, `apps/web/app/(dashboard)/sites/[id]/page.tsx`, `apps/web/app/api/plans/route.ts` before editing.
4. Checked existing route-test patterns (`apps/web/lib/__tests__/sites-get-route.test.ts`, `uptime-route.test.ts`, and `authz-matrix.test.ts` which already calls `plansGET` with a shallow assertion) to model the new `plans-route.test.ts`.
5. Edited `pricing-cards.tsx`: grid cols, `isFeatured` flag, busy/label genericization, seats/white_label rows (later corrected to avoid duplicate people-count row per advisor review).
6. Edited `billing/page.tsx`: added `plan.id === "max"` copy branch above the existing `isPaid` ternary.
7. Added `plans-route.test.ts`.
8. Ran `pnpm --filter web typecheck` (clean), `pnpm --filter web test` (601/601 pass), `pnpm --filter web lint` (clean).
9. Called `advisor()` for a pre-completion review. Findings acted on: (a) verified the `PricingCards` mount point (`app/pricing/page.tsx`) has an adequately wide container for 3 columns — no fix needed; (b) fixed a duplicate "3 seats / 3 teamleden" row on the Max card by making the row conditional/exclusive instead of additive; (c) added the explicit red/green-test honesty note and the vitest-config-backed test-infra-limitation note to this report, rather than relying on the discovery-spec's inherited claim.
10. Re-ran all 5 verification commands after the fix — all green (output pasted above).
11. Wrote `changed-paths-inventory.txt` and this report.

---

**DONE** — Pricing cards render Max as a genuine third tier (3-column grid, generic highlight/CTA/busy-label logic, seats/white-label feature rows without duplicating the members count), and the billing page's plan copy is now plan-aware (max sees seats/white-label copy, pro/free copy unchanged, task-C's isPaid/BillingManager gate untouched). All verification commands pass with real counts (601/601 tests, 63/63 files, typecheck/lint clean across 8 packages). One coverage gap stated honestly: no component-render test exists or was added (node-only vitest env, no jsdom/RTL, `.tsx` files not even in the test glob) — coverage relies on typecheck + lint + the `/api/plans` route test + manual diff review.

Report path: `DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-2/phase-2-task-E-pricing-ui/implementer-report.md`
