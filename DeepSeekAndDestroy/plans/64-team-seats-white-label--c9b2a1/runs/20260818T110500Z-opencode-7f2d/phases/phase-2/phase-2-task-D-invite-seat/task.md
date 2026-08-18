# Task phase-2-task-D-invite-seat — Implementer (Sonnet 5)

**Plan:** 64-team-seats-white-label (step 2 CORE). **Unit D** of the billing discovery spec.
**Type:** implementation (one reviewable unit). Depends on task-A (max contract, accepted) and task-C
(isPaidPlan gates, accepted). Do NOT re-touch task-C's 8 gate sites.

## Objective
Make the team-invite path enforce the plan seat-limit as **HTTP 409 + upsell payload** (today it is a
generic 400 with no upsell), sourcing the limit from `features.seats ?? maxMembers`, and surface it in
the client invite UI as an upsell modal. This is the plan's step-2 acceptance criterion
("invite bij limiet → 409 + upsell; downgrade werkt").

## DECIDED (from orchestrator, MFL-20260818-010 — do not re-litigate)
- **Limit source:** `maxMembersForTeam` returns `plan.features.seats ?? plan.maxMembers` (read the full
  plan record, not just `.maxMembers`). For max: seats=3. For free/pro: seats=null → falls back to
  maxMembers (3 / 10). Behavior for free/pro is UNCHANGED numerically.
- **Upsell next-plan helper:** add `nextPlanForMemberLimit(planId: PlanId): PlanId | null`:
  `free → "pro"`, `pro → null`, `max → null` (max seats 3 < pro maxMembers 10, so there is NO higher
  member tier — pro/max get 409 with NO upsell key). Payload shape when nextPlan exists:
  `{ error, upsell: { plan: nextPlan, feature: "seats" } }`. When null: `{ error }` only, still 409.
- **POST invitations route** (`apps/web/app/api/teams/[teamId]/invitations/route.ts` error map ~:56-58):
  `member_limit` → **409** (+ upsell when nextPlan exists). `already_member`/`pending_exists` stay 409
  (no upsell). Everything else stays 400.
- **Accept route** (`apps/web/app/api/invitations/[token]/accept/route.ts` error map ~:27-36):
  `member_limit` → **409** (no upsell payload — the accepter is not necessarily the owner).
- **InviteError message:** drop the hardcoded "Upgrade naar Pro voor meer leden" (wrong for pro/max).
  Use a next-plan-agnostic message, e.g. `De ledenlimiet van dit plan (${maxMembers}) is bereikt.`
  The route/client build any upsell affordance from the payload.

## Files (see discovery-spec §3 Unit D for detail)
- `apps/web/lib/invites-core.ts`: change `maxMembersForTeam` limit source; update the thrown message;
  add/export `nextPlanForMemberLimit`. Keep `assertSeatAvailable` structure. `createInvitation` and
  `acceptInvitation` seat-count semantics UNCHANGED (create counts accepted+pending; accept counts
  accepted only).
- `apps/web/app/api/teams/[teamId]/invitations/route.ts`: 409 + upsell mapping (compute nextPlan from
  the team's current plan — fetch plan via the existing subscription query / `getPlanForTeam` from
  `@/lib/credits`).
- `apps/web/app/api/invitations/[token]/accept/route.ts`: `member_limit` → 409.
- `apps/web/components/team-settings.tsx` (`sendInvite` ~:50-72): branch on `data?.upsell` (pattern:
  `apps/web/components/sites-manager.tsx:171` reads `data?.upsell`; modal markup ~:707-732; upgrade
  button POSTs `{ planId: data.upsell.plan }` to `/api/billing/checkout`). Render an upsell modal when
  the 409 carries `upsell`; otherwise show `data.error`.

## Tests (TDD — fail-before / pass-after; vitest rooted at apps/web → app-relative paths)
- `apps/web/lib/__tests__/invites-core.test.ts`: add max-limit tests (`subscriptions[0].plan="max"` →
  2 members + 1 pending → member_limit; 1 member + 1 pending OK). Add `nextPlanForMemberLimit` unit
  assertions (free→"pro", pro→null, max→null). Keep existing free/pro limit tests green.
- NEW route test (or extend existing) for `POST /api/teams/:teamId/invitations`: at the free/max limit
  → **409** and, for a free team, an `upsell: { plan: "pro", feature: "seats" }` payload; for a pro team
  at limit → 409 with NO upsell key. (Pattern: existing route tests mocking `@/lib/api-auth` +
  `@/lib/email`.) This test must FAIL today (route returns 400, no upsell) and PASS after.
- Accept route test: `member_limit` → 409.

## Scope discipline
- Accepted baseline = the content-hash `scope-baseline.json` in THIS task dir (captured fresh AFTER
  task-C acceptance). Do NOT modify task-C's gate files, `pricing-cards.tsx`, or migrations.
- Record changed files in `changed-paths-inventory.txt` in this dir.

## Verification (run all from repo root, paste real output)
```
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web lint
pnpm typecheck
pnpm lint
```

## Report
Write `implementer-report.md` in this dir with a Decision Packet (Role/task · Status · Changed paths ·
Criteria per item · Verification with real counts · Scope/preservation · fail-before/pass-after ·
Unresolved risks) + evidence log. Do NOT commit; do NOT run destructive git; edit no DeepSeekAndDestroy
file except the two deliverables. End with your status line + report path.
