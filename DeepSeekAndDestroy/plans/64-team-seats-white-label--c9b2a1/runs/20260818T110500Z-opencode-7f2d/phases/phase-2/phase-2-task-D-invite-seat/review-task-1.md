# Review Task 1 — phase-2-task-D-invite-seat (fresh independent reviewer, Sonnet 5)

You are an INDEPENDENT reviewer. You did NOT implement this. Re-derive everything from source + real
command output; reports/logs are claims, code and your own runs are truth.

Repo root: C:/Users/Yassin/Desktop/scanpal/ScanPal (git, branch `main`; large PRE-EXISTING accepted
baseline — do not flag plan-61/62/63 or phase-1/2 A/B/C changes as this task's scope).

## What the task was
Task spec: `.../phase-2-task-D-invite-seat/task.md` (READ IT). Unit D of discovery-spec
(`.../phase-2-billing-discovery-6e0b/discovery-spec.md` §3 Unit D, §1.4). Decisions: MFL-20260818-010.
Implementer report: `.../phase-2-task-D-invite-seat/implementer-report.md`.

Acceptance criteria (verify each against source):
1. `maxMembersForTeam` limit source = `plan.features.seats ?? plan.maxMembers` (free/pro numeric limits
   UNCHANGED: 3 / 10).
2. `nextPlanForMemberLimit(planId)`: free→"pro", pro→null, max→null (exported).
3. POST `/api/teams/[teamId]/invitations`: `member_limit` → **409**; +`upsell:{plan,feature:"seats"}`
   ONLY when nextPlan exists (free→pro). pro/max at limit → 409 with NO upsell key.
   `already_member`/`pending_exists` stay 409 no-upsell; all other errors stay 400.
4. Accept route `/api/invitations/[token]/accept`: `member_limit` → **409**, no upsell payload.
5. Hardcoded "Upgrade naar Pro voor meer leden" message dropped (now next-plan-agnostic).
6. Client `team-settings.tsx` `sendInvite`: on a 409 carrying `upsell`, render an upsell modal; upgrade
   button POSTs `{ planId: upsell.plan }` to `/api/billing/checkout`. Non-upsell errors still show `error`.
7. create/accept seat-COUNT semantics unchanged.
8. Scope: ONLY invites-core.ts + the 2 invite routes + team-settings.tsx + the 3 test files changed.
   `pricing-cards.tsx`, task-C's 8 gate files, migrations, and plans.ts all byte-identical.

## Top risk hypotheses to actively disprove
1. **The 409+upsell route test is a mock artifact** — confirm it genuinely FAILS against the pre-change
   route (old code returns 400, no upsell) and that the test imports the real route handler / doesn't
   mock away the status mapping. Inspect the pre-image via `git diff` on the route file.
2. **Client modal reads the wrong payload shape.** The implementer claims it reads the REAL shape
   `{ error, upsell: { plan, feature } }` and does NOT reproduce the pre-existing `sites-manager.tsx`
   bug (which stores the whole response into a `{plan,error}`-typed var). Verify team-settings.tsx reads
   `data.upsell.plan` correctly and the upgrade button POSTs `{ planId }` to `/api/billing/checkout`.
3. **Scope creep / broken existing tests.** Verify via content-hash compare that nothing outside the
   declared set changed (the `state.json` hash diff is the ORCHESTRATOR's own edit — ignore it, it is not
   project source). Confirm no existing test that asserted the old invite message or 400 status was
   silently weakened rather than legitimately updated.

## Known, ACCEPTED limitation (do NOT fail for it, but confirm it is stated honestly)
- The `features.seats ?? maxMembers` change is not test-discriminable for max because plans.max has
  maxMembers===features.seats===3 (MFL-010 decision 5). A revert to `maxMembers` alone would still pass.
  This is a data coincidence, not a defect — confirm the CODE is correct and the limitation is disclosed.

## How to verify
- Content-hash scope compare from repo root:
  `python C:/Users/Yassin/.claude/skills/deepseek-and-destroy/scripts/scope_snapshot.py compare --root . --snapshot DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-2/phase-2-task-D-invite-seat/scope-baseline.json`
- `git diff` on the 4 production files (ground truth for gate/status/message logic).
- Re-run: `pnpm --filter web typecheck`, `pnpm --filter web test`, `pnpm --filter web lint`,
  `pnpm typecheck`, `pnpm lint` (vitest rooted at apps/web → app-relative test paths).

## Report
Write `review-1.md` in the task dir: Decision Packet + evidence log + one line on its own
`VERDICT: PASS` or `VERDICT: FAIL`. Mark `FAST-PATH ELIGIBLE: YES` only if independent + verification
complete + scope clean + no orchestrator investigation needed. Genuine pre-existing unrelated defects
(e.g. the sites-manager.tsx quirk) → note as out-of-scope, do NOT fail for them. Read-only: edit no
project source, no DeepSeekAndDestroy file except review-1.md, no commit, no destructive git. End with
the verdict + review path.
