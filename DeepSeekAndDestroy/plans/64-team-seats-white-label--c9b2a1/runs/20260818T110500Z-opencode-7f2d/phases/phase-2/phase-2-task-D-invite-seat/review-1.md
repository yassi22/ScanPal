# Review 1 — phase-2-task-D-invite-seat (independent reviewer, Sonnet 5, round 1)

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Independent reviewer (round 1), did NOT implement. `phase-2-task-D-invite-seat`, plan `64-team-seats-white-label`, phase-2 Unit D. |
| Decision | **PASS** |
| Scope | Content-hash compare: exactly 6 mismatches vs `scope-baseline.json` — the 5 declared files (`invites-core.ts`, both invite routes, `team-settings.tsx`, `invites-core.test.ts`) + `state.json` (orchestrator's own run-state, not project source, per brief — ignored). Zero diffs on `pricing-cards.tsx`, task-C's 8 gate files, or `packages/shared/src/plans.ts`. Two new test files (`invitations-route.test.ts`, `invitation-accept-route.test.ts`) correctly absent from baseline (didn't exist at capture time). |
| Verification | All 5 commands re-run fresh, all green: `pnpm --filter web typecheck` clean · `pnpm --filter web test` 62 files / 600 tests pass · `pnpm --filter web lint` clean · `pnpm typecheck` (8/8 packages) clean · `pnpm lint` clean. |
| Top risks | All 3 actively disproven — see below. |
| Known limitation | Confirmed present, honestly disclosed, and does not affect PASS (see below). |
| FAST-PATH ELIGIBLE | **YES** — independent verification complete, scope clean, no orchestrator investigation needed. |

---

## Method

This repo has no per-task commits (all phase-1/2 work, including this task, sits uncommitted on top of `main` at `0009546`). `git diff HEAD -- <file>` therefore shows the true pre-image → post-image for each of the 4 production files, which is what I used to independently verify the implementer's claims (not their report). I also ran the content-hash `scope_snapshot.py compare` tool named in the brief, read the 3 new/changed test files directly, and re-ran all 5 verification commands myself.

## Acceptance criteria — verified against source

1. **Limit source `plan.features.seats ?? plan.maxMembers`** — confirmed in `apps/web/lib/invites-core.ts:76-77` (`git diff` shows the old line `return plans[planId...].maxMembers;` replaced). `packages/shared/src/plans.ts` (untouched, confirmed via scope compare) shows free `maxMembers:3, seats:null` and pro `maxMembers:10, seats:null` — numerically unchanged (`??` falls through to `maxMembers` for both). Max has `maxMembers:3, seats:3`.
2. **`nextPlanForMemberLimit`** — exported, `free→"pro"`, everything else `→null` (`invites-core.ts:86-88`). Unit tests for all 3 branches in `invites-core.test.ts`.
3. **POST invitations route 409+upsell** — verified via `git diff`: pre-image had no `member_limit` branch at all, so it fell through to the generic `already_member/pending_exists ? 409 : 400` ladder → **400** for `member_limit` (today's real bug being fixed). Post-image adds an explicit `member_limit` branch returning 409, with `upsell` key present only when `nextPlanForMemberLimit(plan.id)` is non-null (object-spread conditional — `upsell` key is genuinely absent, not `undefined`-valued, when there's no next plan). `already_member`/`pending_exists`/other codes untouched.
4. **Accept route 409, no upsell** — `git diff` shows a single added ternary arm `err.code === "member_limit" ? 409 : 400` in the existing status ladder; no upsell payload constructed anywhere in this route. Correct per the DECIDED spec (accepter isn't necessarily the owner).
5. **Hardcoded message dropped** — `git diff` shows `"...is bereikt. Upgrade naar Pro voor meer leden."` → `"...is bereikt."`. Confirmed next-plan-agnostic.
6. **Client modal** — `git diff` on `team-settings.tsx` confirmed: `sendInvite` checks `data?.upsell` before the generic `!res.ok` throw, and stores `{ plan: data.upsell.plan, error: data.error }` — i.e. it correctly unwraps the *nested* `upsell.plan`, not the whole response object. `upgrade()` POSTs `{ planId: upsell?.plan ?? "pro" }` to `/api/billing/checkout`, which I confirmed (`apps/web/app/api/billing/checkout/route.ts:22,45`) is exactly the payload shape that endpoint expects (`parsed.data.planId`). Non-upsell errors still fall through to `setError(...)` unchanged.
7. **Seat-count semantics unchanged** — `createInvitation`/`acceptInvitation` bodies show zero diff beyond the limit-source and message lines; confirmed by direct read of the diff hunks (no other lines touched).
8. **Scope** — see content-hash results above; clean.

## Top risk hypotheses — actively disproven

**1. "409+upsell route test is a mock artifact."** Disproven. `apps/web/lib/__tests__/invitations-route.test.ts` imports `POST` directly from `@/app/api/teams/[teamId]/invitations/route` (the real handler) and mocks only its dependencies (`@/lib/authz`, `@/lib/db`, `@/lib/credits`, `@/lib/email`, and `createInvitation` specifically — via `vi.importActual` + partial override, so `nextPlanForMemberLimit` itself is the *real* implementation, not mocked). The route's own status-mapping and upsell-construction logic (the code I read directly above) is exercised unmocked. Independently confirmed via `git diff` that the pre-image genuinely returned 400 for `member_limit` (no such branch existed) — this is a real, git-diff-verified behavioral change, not a mock artifact.

**2. "Client modal reads the wrong payload shape / reproduces the sites-manager.tsx bug."** Disproven. Read `apps/web/components/sites-manager.tsx:171-172`: `if (data?.upsell) { setUpsell(data); ... }` — stores the *entire* response object into a variable typed `{plan, error}`; `upsell.plan` at render/upgrade time is therefore always `undefined` there (a genuine pre-existing bug, confirmed by inspection — flagged as out-of-scope per the brief, not this task's defect). `team-settings.tsx`'s diff shows the corrected form: `setUpsell({ plan: data.upsell.plan, error: data.error })`, and the modal/upgrade button read `upsell.plan`/`upsell.error` from that correctly-populated local state. This is genuinely NOT the same bug — confirmed by direct comparison of both files.

**3. "Scope creep / silently weakened existing test."** Disproven. Content-hash compare (script run fresh, see Method) shows only the declared 5 production/test files + `state.json` changed; nothing in task-C's 8 gate files, `pricing-cards.tsx`, or migrations touched. On the "weakened test" sub-question: the pre-existing free-plan `member_limit` test previously asserted only `{code: "member_limit"}`; the diff shows a `message` field was *added* to the assertion (strengthened, not weakened), and I confirmed via the implementer's transcript description (independently plausible and consistent with the diff) that this addition is the only change to that test's assertions — no existing assertion was removed or loosened. `already_member`/`pending_exists` 409-no-upsell and "everything else stays 400" behavior is unchanged in the route diff.

## Known accepted limitation — confirmed honestly disclosed

The `features.seats ?? maxMembers` change is not test-discriminable for the Max plan because `plans.max` has `maxMembers: 3` and `features.seats: 3` (equal) — verified directly in `packages/shared/src/plans.ts:83,91`. A revert to `plan.maxMembers` alone would pass every test in this suite unchanged. This is disclosed explicitly in `implementer-report.md` ("Unresolved risks" #1 and the dedicated "What is *not* fail-before proof" section) and is a data coincidence per MFL-20260818-010 decision 5, not a code defect — the `??` line itself is correct as read. Not held against this review; consistent with the brief's instruction not to fail for it.

## Verification — real output (this session, fresh)

- `pnpm --filter web typecheck` → clean (exit 0, no output).
- `pnpm --filter web test` → `Test Files 62 passed (62)`, `Tests 600 passed (600)`. Includes `invites-core.test.ts`, `invitations-route.test.ts` (5 tests), `invitation-accept-route.test.ts` (2 tests), all green.
- `pnpm --filter web lint` → clean (exit 0, no output).
- `pnpm typecheck` (repo-wide) → 8/8 packages `Done`.
- `pnpm lint` (repo-wide) → clean (exit 0, no output).
- `scope_snapshot.py compare` → 6 mismatches (5 declared + orchestrator's own `state.json`), rest of 223 tracked entries unchanged.

## Out-of-scope note

`sites-manager.tsx:171-172`'s `setUpsell(data)` bug (stores whole response into a `{plan,error}`-typed var, so `upsell.plan` reads `undefined` there at render/upgrade time) is a genuine pre-existing defect, unrelated to this task, and out of scope for this review's pass/fail — noted per the brief, not held against this unit.

## Evidence log (file:line references)

- `apps/web/lib/invites-core.ts:67-104` — `maxMembersForTeam`, `nextPlanForMemberLimit`, `assertSeatAvailable` message.
- `apps/web/app/api/teams/[teamId]/invitations/route.ts:58-73` — 409/upsell branch.
- `apps/web/app/api/invitations/[token]/accept/route.ts:27-40` — 409 branch, no upsell.
- `apps/web/components/team-settings.tsx:33,51-52,66-69,82-97,291-320` — upsell state/modal, correct payload unwrap.
- `apps/web/components/sites-manager.tsx:171-172,335` — pre-existing out-of-scope defect (comparison baseline for risk #2).
- `apps/web/app/api/billing/checkout/route.ts:22,45` — confirms `{planId}` request shape matches what the client posts.
- `packages/shared/src/plans.ts:42-95` — plan numbers (free/pro unchanged; max seats===maxMembers coincidence).
- `apps/web/lib/__tests__/invitations-route.test.ts`, `apps/web/lib/__tests__/invitation-accept-route.test.ts` — real-handler route tests.
- `apps/web/lib/__tests__/invites-core.test.ts` (diff) — added max-limit tests, `nextPlanForMemberLimit` unit tests, strengthened message assertion.

VERDICT: PASS
