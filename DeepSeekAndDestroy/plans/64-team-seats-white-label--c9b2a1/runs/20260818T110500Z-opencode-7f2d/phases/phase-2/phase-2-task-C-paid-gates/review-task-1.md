# Review Task 1 — phase-2-task-C-paid-gates (fresh independent reviewer, Sonnet 5)

You are an INDEPENDENT reviewer. You did NOT implement this. Trust nothing in the implementer
report until you have re-derived it from the actual files and real command output. Reports and logs
are claims; the code and test runs are truth.

Repo root: C:/Users/Yassin/Desktop/scanpal/ScanPal (git, branch `main`; large pre-existing accepted
baseline — do NOT flag pre-existing plan-61/62/63 or phase-1/2 changes as this task's scope).

## What the task was (verify against this)
Task spec: `.../phase-2-task-C-paid-gates/task.md` (READ IT). Unit C of the billing discovery spec
(`.../phase-2-billing-discovery-6e0b/discovery-spec.md` §1.3/§3). MFL-008.
Decisions: `.../major-findings-and-fixes.md` MFL-20260818-008 and MFL-20260818-010.
Implementer report: `.../phase-2-task-C-paid-gates/implementer-report.md`.

Acceptance criteria:
1. `isPaidPlan = (id: PlanId) => id !== "free"` added to `packages/shared/src/plans.ts`, exported via
   the shared barrel, importable from `@scanpal/shared`.
2. EXACTLY the 8 enumerated plan-identity gates broadened to use `isPaidPlan(...)` (7 call sites +
   `BillingManager` prop `isPro`→`isPaid`). Logic direction preserved (free still blocked; pro AND max
   now allowed). No inverted `!`.
3. Upsell payload targets stay `"pro"` (unchanged). Feature-flag (`plan.features.*`) gates untouched.
4. NO edits to task D/E territory: `apps/web/lib/invites-core.ts`, `apps/web/components/pricing-cards.tsx`,
   billing-page copy (~:66-69). `isPaidPlan` used at NO site outside the 8.
5. TDD: new tests genuinely FAIL before the gate change and PASS after — and the route tests fail
   BEHAVIORALLY (403→200 for a max plan), not merely as an import/compile error.
6. All verification green; scope = exactly the declared 14 files, everything else byte-identical.

## How to verify (do the work)
- **Scope/preservation (content hashes):** run
  `python C:/Users/Yassin/.claude/skills/deepseek-and-destroy/scripts/scope_snapshot.py compare --root . --snapshot .../phase-2-task-C-paid-gates/scope-baseline.json`
  from repo root. Confirm the changed set is a subset of the declared 14 and that no unexpected file
  (esp. invites-core.ts / pricing-cards.tsx) changed. Also `git status --porcelain` cross-check.
- **Gates:** open all 8 files; confirm each gate's boolean and that free→blocked / pro→allowed /
  max→allowed. Grep the whole repo for `isPaidPlan` — must be only the 7 call sites + definition + tests.
- **Upsell + feature gates:** grep the 3 API routes for `upsell` and confirm `plan: "pro"` unchanged;
  confirm `plan.features.*` gates in sites pages untouched.
- **TDD reality:** re-run the verification commands yourself (vitest rooted at apps/web → app-relative
  paths). Independently confirm at least one route test truly gates on max: e.g. temporarily reason
  about / inspect that the test sets plan `max` and expects 200 where the old `=== "pro"` would 403.
- **Full verification:** `pnpm --filter shared typecheck && pnpm --filter shared test`,
  `pnpm --filter web typecheck`, `pnpm --filter web test`, `pnpm --filter web lint`, `pnpm typecheck`, `pnpm lint`.

## Top risk hypotheses to actively disprove
1. A gate lost/gained a `!` during the rewrite, silently changing free or pro behavior.
2. The "fail-before" for a route was an import/compile error (not a real 403→200 behavior change).
3. Scope creep into invites-core.ts / pricing-cards.tsx / billing copy (task D/E collision).

## Report
Write `review-1.md` in the task dir with a Decision Packet + evidence log. Put ONE line, on its own:
`VERDICT: PASS` or `VERDICT: FAIL`. PASS = zero unresolved task-relevant findings + real verification.
If FAIL, give a numbered list: file:location, what's wrong, why it matters, exact fix. Mark
`FAST-PATH ELIGIBLE: YES` only if independent, verification complete, scope/preservation clean, no
orchestrator investigation needed. Pre-existing unrelated defects → note as out-of-scope, don't fail
for them. Do NOT edit any project source (read-only review) or any DeepSeekAndDestroy file except
`review-1.md`. End your reply with the verdict and the review path.
