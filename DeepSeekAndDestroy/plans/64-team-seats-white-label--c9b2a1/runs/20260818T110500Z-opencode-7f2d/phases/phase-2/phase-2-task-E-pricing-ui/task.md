# Task phase-2-task-E-pricing-ui — Implementer (Sonnet 5)

**Plan:** 64-team-seats-white-label (step 2 UI). **Unit E** of the billing discovery spec.
**Type:** implementation (one reviewable unit). Depends on task-A (max in plans/planList, accepted) and
task-C (isPaid prop on billing page/manager, accepted). Do NOT re-touch task-C gate logic or task-D
invite/upsell code.

## Objective
Make the pricing + billing UI render the **max** plan as a real third tier (today the grid + CTA +
button logic are hardcoded 2-tier / pro-only). All display values already exist in
`packages/shared/src/plans.ts` (`plans.max`: name "Max", priceCents = pro×4, annualPriceCents = pro×4,
maxMembers 3, features incl. `seats:3`, `white_label:true`) and `planList` already has 3 entries — so
this is purely presentational wiring; do NOT change plan data.

## DECIDED (from orchestrator, MFL-20260818-010 — do not re-litigate)
- Max display pricing is already in plans.ts (display-only; real charge is Stripe env). Render from
  `plan.priceCents`/`plan.annualPriceCents`/`plan.name`/`plan.features` — no hardcoded numbers.
- There is NO pro→max member upsell (max seats 3 < pro maxMembers 10). Do NOT render any UI implying
  "upgrade from Pro to Max for more seats." Max is a distinct tier (white-label + workspaces + resale),
  not a bigger-team tier.

## Files (see discovery-spec §3 Unit E for exact lines)
- `apps/web/components/pricing-cards.tsx`:
  - grid `md:grid-cols-2` (~:87) → 3 columns.
  - `plan.id === "pro"` highlight (~:98): make max the highlighted/featured tier (or highlight pro+max —
    pick one and be consistent); genericize so it is not literally pinned to "pro".
  - register/CTA conditionals (~:157,162) and button busy/label logic (~:178, currently `busy === "pro"`
    / "Upgrade naar Pro") → genericize: `busy === plan.id`, label `Upgrade naar {plan.name}`.
  - Optionally surface `plan.features.seats` (seats count) and `plan.features.white_label` as feature rows
    alongside the existing uptime/github rows (keep existing rows intact).
- `apps/web/app/(dashboard)/billing/page.tsx`:
  - The `isPaid` copy branch (~:66-69, already `isPaid` after task-C) — where the current copy is
    pro-specific, make it plan-aware so a max subscriber sees max-appropriate copy (seats/white-label),
    a pro subscriber still sees pro copy, free unchanged. Do NOT alter the `isPaid`/BillingManager gate
    logic from task-C — only the human-readable copy.
- `apps/web/app/(dashboard)/sites/page.tsx` / `sites/[id]/page.tsx`: no copy change expected (feature
  props drive them via task-C) — just VERIFY they render correctly for a max plan; report if a change is
  genuinely needed (else leave untouched).

## Tests (vitest rooted at apps/web → app-relative paths)
- No pricing-UI test exists today (glob `*plans*.test.ts` → 0; `.tsx` component tests → 0; vitest is
  node-only). A route-level assertion IS feasible and valuable: add/extend a test for `GET /api/plans`
  asserting the response now contains 3 plans including `max` with `features.seats`/`white_label`
  (pattern: existing route tests). If you determine a component render test is infeasible without adding
  jsdom/RTL infra (out of scope), state that explicitly and rely on the /api/plans test + typecheck/lint.
- Keep all existing tests green.

## Scope discipline
- Accepted baseline = the content-hash `scope-baseline.json` in THIS task dir (captured fresh AFTER
  task-D acceptance). Do NOT modify plans.ts data, task-C gate files, or task-D invite/upsell files.
- Record changed files in `changed-paths-inventory.txt`.

## Verification (run all from repo root, paste real output)
```
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web lint
pnpm typecheck
pnpm lint
```

## Report
Write `implementer-report.md` (Decision Packet: Role/task · Status · Changed paths · Criteria per item ·
Verification real counts · Scope/preservation vs baseline · any test-infra limitation stated honestly ·
Unresolved risks) + evidence log. Do NOT commit; no destructive git; edit no DeepSeekAndDestroy file
except the two deliverables. End with status line + report path.
