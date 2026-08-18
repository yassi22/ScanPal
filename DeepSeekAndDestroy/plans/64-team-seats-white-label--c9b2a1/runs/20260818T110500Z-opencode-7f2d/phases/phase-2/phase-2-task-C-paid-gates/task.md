# Task phase-2-task-C-paid-gates — Implementer (Sonnet 5)

**Plan:** 64-team-seats-white-label (step 2). **Unit C** of the billing discovery spec.
**Type:** implementation (one reviewable unit). **Model:** Sonnet 5 subagent.

## Objective
Broaden the 8 **plan-IDENTITY** feature gates from `plan.id === "pro"` (or `!== "pro"`) to a
shared `isPaidPlan(...)` helper so the new **max** plan unlocks the same paid features as pro.
This is MFL-20260818-008. Feature-flag gates (`plan.features.*`) already follow the max record and
MUST NOT be touched.

## DECIDED (do not re-litigate — from orchestrator, MFL-010/008)
- **Helper location + definition:** add to `packages/shared/src/plans.ts`:
  `export const isPaidPlan = (id: PlanId): boolean => id !== "free";`
  Export it from `packages/shared/src/index.ts` (the barrel re-exports `./plans`, so if it's a named
  export of plans.ts it is already re-exported — verify). apps/web imports it from `@scanpal/shared`.
- **Upsell targets stay "pro":** these gates broaden only the *condition* (who is allowed in). The
  upsell payload `plan` shown to a *free* user stays `"pro"` (cheapest paid tier that unlocks the
  feature). Do NOT change any `upsell: { plan: "pro" }` target. Only the gate boolean changes.
- **Prop rename:** `BillingManager`'s `isPro` prop → `isPaid` (and the internal `isProActive` /
  usage), fed by `isPaidPlan(plan.id)`.

## Exact scope — the 8 sites (see discovery-spec §1.3 / §3 Unit C for file:line)
Discovery spec (READ IT for exact lines):
`../../phase-2-billing-discovery-6e0b/discovery-spec.md`
1. `apps/web/app/(dashboard)/billing/page.tsx` (`isPro` ~:35 → `isPaid = isPaidPlan(plan.id)`; pass to BillingManager)
2. `apps/web/components/billing-manager.tsx` (prop `isPro`→`isPaid` ~:17,21,88-89)
3. `apps/web/app/api/threats/route.ts` (~:31)
4. `apps/web/app/api/threats/events/route.ts` (~:32)
5. `apps/web/app/api/sites/[id]/honeypot/route.ts` (~:36)
6. `apps/web/app/api/sites/[id]/schedule/route.ts` (~:44-56)
7. `apps/web/app/(dashboard)/threats/page.tsx` (~:41)
8. `apps/web/app/(dashboard)/sites/page.tsx` (~:37 `schedulingEnabled={...}`)
Line numbers are hints — grep for `=== "pro"` / `!== "pro"` / `isPro` in these files and verify each
is a plan-identity gate before editing. If you find a plan-identity gate NOT in this list, STOP and
record it in your report rather than silently expanding scope.

**HARD SCOPE RULE:** use `isPaidPlan` at ONLY these 8 enumerated sites. Do NOT grep the repo for
`=== "pro"` and "helpfully" convert other occurrences. In particular DO NOT touch
`apps/web/lib/invites-core.ts` (that is task D) or `apps/web/components/pricing-cards.tsx` /
`apps/web/app/(dashboard)/billing/page.tsx` copy at ~:66-69 (that is task E). Max is NOT a uniform
superset of pro (max seats 3 < pro maxMembers 10 — see MFL-010): the helper name is a convenience for
these pro-or-better feature gates only, not a licence to rewrite every plan comparison.

## Tests (TDD — fail-before / pass-after)
Add/extend tests proving a **max** plan now passes these gates where it previously 403'd:
- At minimum add API-route coverage that a `max`-plan team is ALLOWED through at least the threats
  route and the schedule route (previously 403). Follow existing patterns in
  `apps/web/lib/__tests__/` (e.g. how scans/threats route tests mock `@/lib/api-auth` + plan).
- Add a `packages/shared` assertion for `isPaidPlan`: `isPaidPlan("free")===false`,
  `isPaidPlan("pro")===true`, `isPaidPlan("max")===true` (place in the existing shared plans test
  file `packages/shared/src/__tests__/plans.test.ts` if present).
- Keep all existing tests green (free still 403; pro still allowed).
New behavioral tests must FAIL before your gate change and PASS after — capture that in the report.

## Scope discipline
- Accepted baseline tree = `scope-baseline.txt` in this task dir (68 pre-existing changed paths from
  plans 61/62/63 + phase-1/2). DO NOT modify anything outside the files needed for this unit.
- Do NOT touch `plan.features.*` gates, migrations, or unrelated files.
- Record every file you change in `changed-paths-inventory.txt` in this task dir.

## Verification (run all, paste real output into the report)
```
pnpm --filter shared typecheck && pnpm --filter shared test
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web lint
pnpm typecheck
pnpm lint
```
(Run from repo root `C:/Users/Yassin/Desktop/scanpal/ScanPal`. Toolchain = pnpm; it works.)
**vitest is rooted at `apps/web` with include `lib/**/*.test.ts`.** If you scope tests to specific
files, the paths must be **app-relative** (e.g. `lib/__tests__/billing-routes.test.ts`), NOT
repo-relative (`apps/web/lib/__tests__/...` errors "No test files found"). `pnpm --filter web test`
with no path runs the whole suite and is safe.

## Scope baseline for the reviewer
Content-hash baseline (247 entries, pre-change) is at `scope-baseline.json` in this task dir. The
reviewer will run `scope_snapshot.py compare` against it to prove exactly which files changed and that
everything else is byte-identical. Do not edit that file.

## Report (REQUIRED)
Write `implementer-report.md` in THIS task dir with a **Decision Packet** at the top:
Role/task · Status · Changed paths (exact) · Criteria summary (each gate + helper + tests) ·
Verification summary (real command results, counts) · Scope/preservation result (diff vs baseline) ·
Fail-before/pass-after evidence · Unresolved risks. Then a detailed evidence log.
End the report with your final status line. Do not judge your own work as reviewed — a separate
reviewer will verify.
