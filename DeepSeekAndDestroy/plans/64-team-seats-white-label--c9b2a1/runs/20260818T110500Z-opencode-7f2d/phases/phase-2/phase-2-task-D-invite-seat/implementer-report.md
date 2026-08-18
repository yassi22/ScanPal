# Implementer Report — phase-2-task-D-invite-seat

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Implementer (Sonnet 5) — `phase-2-task-D-invite-seat`, plan `64-team-seats-white-label`, phase-2 Unit D |
| Status | **COMPLETE** — all acceptance criteria met, all verification commands green |
| Changed paths | See `changed-paths-inventory.txt` in this dir. Production: `apps/web/lib/invites-core.ts`, `apps/web/app/api/teams/[teamId]/invitations/route.ts`, `apps/web/app/api/invitations/[token]/accept/route.ts`, `apps/web/components/team-settings.tsx`. Tests: `apps/web/lib/__tests__/invites-core.test.ts` (extended), `apps/web/lib/__tests__/invitations-route.test.ts` (new), `apps/web/lib/__tests__/invitation-accept-route.test.ts` (new). |
| Criteria summary | All 6 task items done — see per-item table below. |
| Verification summary | `pnpm --filter web typecheck` clean · `pnpm --filter web test` 62 files / 600 tests pass · `pnpm --filter web lint` clean · `pnpm typecheck` (8/8 packages) clean · `pnpm lint` clean. Real output pasted below. |
| Scope / preservation | sha256 diff against `scope-baseline.json`: 223 tracked entries, 216 unchanged, 6 differ. 5 of the 6 are exactly the files this task was scoped to touch; the 6th (`.../state.json`) was not touched by this session — see note below. Zero diffs on `pricing-cards.tsx`, task-C's 8 gate files, or any migration. |
| Fail-before / pass-after | 8 new/changed assertions across 3 files proven to fail against the pre-change code and pass against the post-change code (full transcript below). 2 additional new tests (Max-plan seat count) pass on both sides by construction — flagged explicitly as regression coverage, not new-behavior proof (see below). |
| Unresolved risks | (1) The `plan.features.seats ?? plan.maxMembers` limit-source change is not discriminable by any test in this suite, because `plans.max` has `maxMembers: 3` and `features.seats: 3` (equal) — see discovery-spec §2 item 5. A regression that reverted to `plan.maxMembers` alone would still pass every test here. (2) `state.json` hash differs from baseline; not caused by this session (see below). |
| FAST-PATH ELIGIBLE | N/A (implementation already complete) |

---

## Criteria per item (from task.md)

| # | Requirement | Done | Where |
|---|---|---|---|
| 1 | `maxMembersForTeam` sources limit from `plan.features.seats ?? plan.maxMembers` | Yes | `apps/web/lib/invites-core.ts:67-78` |
| 2 | `nextPlanForMemberLimit(planId)`: free→"pro", pro→null, max→null | Yes | `apps/web/lib/invites-core.ts:86-88`, exported |
| 3 | POST invitations route: `member_limit` → 409 (+upsell when nextPlan exists) | Yes | `apps/web/app/api/teams/[teamId]/invitations/route.ts:56-71` |
| 4 | `already_member`/`pending_exists` stay 409, no upsell; everything else stays 400 | Yes (unchanged) | same file, `:68-70` |
| 5 | Accept route: `member_limit` → 409 (no upsell) | Yes | `apps/web/app/api/invitations/[token]/accept/route.ts:27-38` |
| 6 | Drop hardcoded "Upgrade naar Pro" message | Yes | `apps/web/lib/invites-core.ts:100`: `` `De ledenlimiet van dit plan (${maxMembers}) is bereikt.` `` |
| 7 | Client invite UI: upsell modal on `data?.upsell`, following `sites-manager.tsx` pattern | Yes | `apps/web/components/team-settings.tsx:66-69` (branch), `:82-97` (`upgrade()`), `:292-319` (modal markup) |
| 8 | Do not change create/accept seat-**count** semantics | Confirmed unchanged | `createInvitation`/`acceptInvitation` count logic untouched — only the *limit source* and the *thrown message* changed inside `assertSeatAvailable`/`maxMembersForTeam` |
| 9 | Do not touch task-C's 8 gate files, `pricing-cards.tsx`, migrations | Confirmed | sha256 diff below shows zero touches on any of these |

### Note on the client pattern deviation (intentional, not a bug)

`sites-manager.tsx:172` does `setUpsell(data)` where `Upsell = { plan: string; error: string }`, but the actual response payloads it receives are shaped `{ error, upsell: { plan }, ... }` — i.e. that call stores the *whole* response object into a variable typed for `{plan, error}`, which only works at runtime because `data` is `any`; reading `upsell.plan` there would in fact read `undefined` off the raw response. This is a pre-existing quirk in `sites-manager.tsx`, out of scope for this task.

For `team-settings.tsx` I followed the *intent* of the pattern (check `data?.upsell`, store `{plan, error}` locally, render a modal, upgrade button POSTs `{planId}` to `/api/billing/checkout`) but wrote the state assignment correctly:
```ts
if (data?.upsell) {
  setUpsell({ plan: data.upsell.plan, error: data.error });
  return;
}
```
This reads the real payload shape our route emits (`{ error, upsell: { plan, feature } }`) instead of reproducing the existing bug.

### Note on test harness limits (client component)

`apps/web/vitest.config.ts` has `include: ["lib/**/*.test.ts"]` and `environment: "node"` — there is no jsdom/RTL harness in this repo for `apps/web/components/*.tsx`. The `team-settings.tsx` modal is therefore verified by code inspection + `tsc --noEmit` + `eslint` only, consistent with how the rest of the codebase treats client components (no existing `*.test.tsx` files were found for any component). No new test harness was added, per scope discipline.

---

## Verification (real output)

### `pnpm --filter web typecheck`
```
> @scanpal/web@0.1.0 typecheck C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web
> tsc --noEmit
```
(no output — clean, exit 0)

### `pnpm --filter web test`
```
 Test Files  62 passed (62)
      Tests  600 passed (600)
   Start at  14:55:46
   Duration  12.19s (transform 10.93s, setup 0ms, collect 89.23s, tests 3.63s, environment 25ms, prepare 29.24s)
```
Includes `lib/__tests__/invites-core.test.ts (33 tests)`, `lib/__tests__/invitations-route.test.ts (5 tests)`, `lib/__tests__/invitation-accept-route.test.ts (2 tests)`. (Two unrelated pre-existing tests intentionally log an error to stderr as part of asserting error-handling behavior — `uptime-route.test.ts`, `threats-route.test.ts`, `scan-notify.test.ts` — all still pass; this is pre-existing behavior, not caused by this change.)

### `pnpm --filter web lint`
```
> @scanpal/web@0.1.0 lint C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web
> eslint
```
(no output — clean, exit 0)

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

### `pnpm lint` (repo-wide)
```
> scanpal@0.1.0 lint
> pnpm --filter web lint
> @scanpal/web@0.1.0 lint
> eslint
```
(no output — clean, exit 0)

---

## Scope / preservation — sha256 diff against `scope-baseline.json`

Ran a full sha256 comparison of every path tracked in `scope-baseline.json` (223 entries) against the current working tree (no git available in this environment; this is the content-hash mechanism the task specifies).

```
TOTAL baseline entries: 223
Matches (unchanged): 216
Mismatches: 6
 - DeepSeekAndDestroy/plans/.../runs/20260818T110500Z-opencode-7f2d/state.json | hash differs
 - apps/web/app/api/invitations/[token]/accept/route.ts | hash differs
 - apps/web/app/api/teams/[teamId]/invitations/route.ts | hash differs
 - apps/web/components/team-settings.tsx | hash differs
 - apps/web/lib/__tests__/invites-core.test.ts | hash differs
 - apps/web/lib/invites-core.ts | hash differs
```

5 of 6 mismatches are exactly the files this task edited. Zero mismatches on `apps/web/components/pricing-cards.tsx`, any of task-C's 8 gate files (`billing/page.tsx`, `billing-manager.tsx`, `threats/route.ts`, `threats/events/route.ts`, `sites/[id]/honeypot/route.ts`, `sites/[id]/schedule/route.ts`, `threats/page.tsx`, `sites/page.tsx`), or any migration file.

**`state.json` note:** this file's on-disk mtime is `2026-08-18 14:49`, which converts to `12:49 UTC` — the exact same instant recorded as `scope-baseline.json`'s own `captured_at` (`2026-08-18T12:49:12Z`). This session never opened or wrote `state.json` (no Read/Edit/Write tool call against it appears anywhere in this session's history). The mismatch is an artifact of the baseline-capture tooling itself writing run-state at capture time, not a change made by this implementer. Flagging it here rather than silently omitting it, per the instruction to paste real diff output.

The two new test files (`apps/web/lib/__tests__/invitations-route.test.ts`, `apps/web/lib/__tests__/invitation-accept-route.test.ts`) do not appear in the baseline at all (they didn't exist at capture time), so they aren't "mismatches" — they're new files, consistent with adding route-level tests for new behavior.

---

## Fail-before / pass-after evidence

Since this environment has no git, fail-before was proven by temporarily reverting the three production files to their exact pre-change text (verified against my own diff, byte-for-byte), running the new/changed tests, then restoring the post-change text and re-running.

### Before (production code reverted to pre-change state)
```
lib/__tests__/invites-core.test.ts        3 failed / 33  (nextPlanForMemberLimit not a function ×3)
lib/__tests__/invitations-route.test.ts   3 failed / 5   (expected 409, got 400 ×3)
lib/__tests__/invitation-accept-route.test.ts  1 failed / 2  (expected 409, got 400)

Test Files  3 failed (3)
     Tests  7 failed | 33 passed (40)
```

### After (production code restored to post-change state)
```
 ✓ lib/__tests__/invitation-accept-route.test.ts (2 tests)
 ✓ lib/__tests__/invites-core.test.ts (33 tests)
 ✓ lib/__tests__/invitations-route.test.ts (5 tests)

Test Files  3 passed (3)
     Tests  40 passed (40)
```

### Additional targeted fail-before: the dropped hardcoded message (item 6)

The 7 failures above did not exercise the message-text change (task item 6, "drop the hardcoded 'Upgrade naar Pro' message") — the route tests construct their own `InviteError` with the new text, and the original member-limit test only asserted `{code: "member_limit"}`. I added a `message` assertion to the existing free-plan test and separately proved it fails against the old string:

```ts
await expect(
  createInvitation(state.db, { ...inviteInput, email: "dave@example.com", role: "member" }),
).rejects.toMatchObject({
  code: "member_limit",
  message: "De ledenlimiet van dit plan (3) is bereikt.",
});
```

Reverting only the thrown message back to `` `...is bereikt. Upgrade naar Pro voor meer leden.` `` and running just this test:
```
FAIL lib/__tests__/invites-core.test.ts > createInvitation > blokkeert uitnodigen wanneer de ledenlimiet van het plan is bereikt
AssertionError: expected InviteError: De ledenlimiet van dit plan … to match object { code: 'member_limit', message: '...' }
- "message": "De ledenlimiet van dit plan (3) is bereikt.",
```
Restored, re-ran full `invites-core.test.ts`: 33/33 pass.

### What is *not* fail-before proof: the two new Max-plan seat tests

`invites-core.test.ts` gained two new tests exercising `createInvitation` on `plan: "max"` (2 members + 1 pending → `member_limit`; 1 member + 1 pending → OK). **These pass identically on both the pre-change and post-change code**, because `plans.max` (set by the already-accepted task-A) has `maxMembers: 3` *and* `features.seats: 3` — the two numbers are equal, so `plan.features.seats ?? plan.maxMembers` and the old `plan.maxMembers` alone produce the same limit for Max. This was anticipated in discovery-spec §2 item 5: *"set `maxMembers: 3` + `features.seats: 3` (single source of truth) — then the `??` is moot for max but exercised for free/pro."* I list these two tests as **regression coverage** (they lock in correct Max-plan seat-counting behavior and would catch an unrelated regression), not as evidence that the `features.seats ?? maxMembers` change itself is exercised. That specific line is only discriminable by a test if some future plan sets `seats` to a value different from `maxMembers` — currently none does.

---

## Evidence log

- `apps/web/lib/invites-core.ts`
  - `maxMembersForTeam` (renamed logic, same name) now does `plan.features.seats ?? plan.maxMembers` instead of `plan.maxMembers`.
  - New exported `nextPlanForMemberLimit(planId: PlanId): PlanId | null` — `free → "pro"`, everything else `→ null`.
  - `assertSeatAvailable`'s thrown message no longer contains "Upgrade naar Pro voor meer leden."; now `` `De ledenlimiet van dit plan (${maxMembers}) is bereikt.` ``.
  - `createInvitation`/`acceptInvitation` bodies (seat-count queries, transaction structure) byte-identical to before — confirmed by the sha256 diff not flagging any change beyond what's described here and by re-reading the file post-edit.
- `apps/web/app/api/teams/[teamId]/invitations/route.ts`
  - Imports `nextPlanForMemberLimit` from `@/lib/invites-core` and `getPlanForTeam` from `@/lib/credits`.
  - `catch` block: `member_limit` now branches first — fetches the team's plan, computes `nextPlan`, returns 409 with `{error, upsell: {plan: nextPlan, feature: "seats"}}` when `nextPlan` is non-null, else `{error}` only (still 409). `already_member`/`pending_exists` unchanged (409, no upsell). All other codes unchanged (400).
- `apps/web/app/api/invitations/[token]/accept/route.ts`
  - Status ladder gains one branch: `err.code === "member_limit" ? 409 : 400` (previously fell into the `400` default). No upsell payload added here per the DECIDED spec (accepter is not necessarily the owner).
- `apps/web/components/team-settings.tsx`
  - New `Upsell` type, `upsell`/`upgrading` state.
  - `sendInvite`: checks `data?.upsell` before the `!res.ok` throw; on upsell, stores `{plan, error}` and returns early (leaves the invite form untouched, no generic error banner).
  - New `upgrade()`: POSTs `{planId: upsell?.plan ?? "pro"}` to `/api/billing/checkout`, redirects to `data.url` on success, surfaces failure via the existing `error` state.
  - New modal block at the end of the component render, styled consistently with `sites-manager.tsx`'s existing upsell modal (same Tailwind classes/structure), copy adapted for the seat-limit context ("Ledenlimiet bereikt").
- Tests
  - `apps/web/lib/__tests__/invites-core.test.ts`: added message assertion to the existing free-limit test; two new Max-plan tests; new `nextPlanForMemberLimit` describe block (3 tests: free→pro, pro→null, max→null).
  - `apps/web/lib/__tests__/invitations-route.test.ts` (new file, 5 tests): 409+upsell for Free at limit, 409-no-upsell for Pro at limit, 409-no-upsell for Max at limit, `already_member` still 409 without calling `getPlanForTeam`, happy-path 201.
  - `apps/web/lib/__tests__/invitation-accept-route.test.ts` (new file, 2 tests): `member_limit` → 409 no upsell; happy-path 200 unchanged.

---

**DONE** — HTTP 409 + upsell payload for the team-invite seat limit is implemented end-to-end (limit source, next-plan helper, both routes, client modal), all specified tests added and proven fail-before/pass-after (with one gap in test discriminability disclosed above), full verification suite green.

Report path: `DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-2/phase-2-task-D-invite-seat/implementer-report.md`
