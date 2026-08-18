# Review Task 1 — phase-2-task-E-pricing-ui (fresh independent reviewer, Sonnet 5)

You are an INDEPENDENT reviewer. You did NOT implement this. Re-derive from source + real command
output; the report is a claim, code and your own runs are truth.

Repo root: C:/Users/Yassin/Desktop/scanpal/ScanPal (git, branch `main`; large PRE-EXISTING accepted
baseline — do not flag plan-61/62/63 or phase-1/2 A/B/C/D changes as this task's scope).

## What the task was
Task spec: `.../phase-2-task-E-pricing-ui/task.md` (READ IT). Unit E of discovery-spec §3.
Decisions: MFL-20260818-010. Implementer report: `.../phase-2-task-E-pricing-ui/implementer-report.md`.

Acceptance criteria (verify each against `git diff` on the 2 production files):
1. `pricing-cards.tsx`: grid → 3 columns; the `plan.id === "pro"` highlight, register/CTA conditionals,
   and busy/label logic are genericized (`busy === plan.id`, `Upgrade naar {plan.name}`); optional
   seats/white_label rows added WITHOUT breaking the existing uptime/github rows.
2. `billing/page.tsx`: the `isPaid` COPY branch (~:66-69) is now plan-aware (max shows seats/white-label;
   pro unchanged; free unchanged). The `isPaid`/`isOwner` computation and the `BillingManager` gate props
   (task-C logic, ~:34-36, ~:90-94) are BYTE-IDENTICAL — only JSX copy changed.
3. NO "upgrade from Pro to Max for more seats" affordance anywhere (max seats 3 < pro maxMembers 10 —
   there is no pro→max member upsell). Each paid card is an independent purchase target.
4. New `GET /api/plans` test asserts 3 plans incl. max with `features.seats===3`/`white_label===true`
   and free/pro `seats===null`/`white_label===false`.
5. Plan DATA unchanged (`packages/shared/src/plans.ts` byte-identical).

## Implementer judgment call to validate (not auto-fail)
The implementer REPLACED the max card's "Maximaal {maxMembers} teamleden" row with a "{seats} betaalde
seats" row (single people-count line) instead of adding a second row, to avoid a contradictory
double people-count on the Max card (both "3") sitting under Pro's "10". Confirm: (a) free/pro cards
still show their normal members row unchanged; (b) only the max branch differs; (c) this is a
contained, sensible UX correctness choice, not scope creep. If you judge it wrong, say why concretely.

## Top risk hypotheses to actively disprove
1. **Free/pro rendering regressed** — the grid/highlight/CTA/label genericization or the seats-row
   change silently altered how free or pro cards render (label text, checkout target, members row).
2. **billing/page.tsx gate logic touched** — the diff strays beyond the `<p>` copy block into the
   `isPaid`/BillingManager props (would collide with task-C).
3. **Scope creep** — anything beyond the 2 production files + 1 new test changed; esp. plans.ts,
   task-C gate files, task-D invite files, or pricing-cards's checkout POST body shape.

## How to verify
- Content-hash compare from repo root:
  `python C:/Users/Yassin/.claude/skills/deepseek-and-destroy/scripts/scope_snapshot.py compare --root . --snapshot DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-2/phase-2-task-E-pricing-ui/scope-baseline.json`
  (the `state.json` diff is the orchestrator's own edit — ignore it.)
- `git diff` on `pricing-cards.tsx` and `billing/page.tsx` (ground truth).
- Re-run: `pnpm --filter web typecheck`, `pnpm --filter web test`, `pnpm --filter web lint`,
  `pnpm typecheck`, `pnpm lint` (vitest rooted at apps/web → app-relative test paths).
- Read the new `plans-route.test.ts` in full — confirm it hits the real route and asserts the max shape.

## Report
Write `review-1.md` in the task dir: Decision Packet + evidence log + one line on its own
`VERDICT: PASS` or `VERDICT: FAIL`. Mark `FAST-PATH ELIGIBLE: YES` only if independent + verification
complete + scope clean + no orchestrator investigation needed. Read-only: no project source edits, no
commit, no destructive git, edit no DeepSeekAndDestroy file except review-1.md. End with verdict + path.
