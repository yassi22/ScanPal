# Phase-2 Hard Gate — Phase Audit (fresh, independent)

**Auditor**: fresh Sonnet 5, no prior involvement in phase-2 implementation.
**Scope**: plan-wide integration synthesis across tasks A–E + full repo verification suite. Not a
line-by-line re-review (each task already passed independent reviewer + orchestrator fast-path
acceptance — MFL-20260818-015/016/017/018).
**Repo state**: uncommitted `main`; large pre-existing accepted baseline from other plans + phase-1
present and correctly out of scope for this gate.

---

## Decision Packet

| Field | Value |
|---|---|
| Role / Task | Phase Auditor — phase-2 hard gate (plan 64-team-seats-white-label, step 2) |
| Status | COMPLETE |
| Verdict | READY |
| Changed paths | none (read-only audit; only `phase-audit.md` written) |
| Verification summary | `pnpm typecheck` exit 0 (8/8 packages "Done", repo-wide); `pnpm lint` exit 0 — **note**: the root `lint` script is `pnpm --filter web lint` by repo design (verified: `package.json:10`; no `packages/shared`, `packages/db`, `packages/scan-core`, `apps/worker`, or `apps/scheduler` package.json defines a `lint` script) — eslint coverage is web-app-only across this whole repo, not a phase-2 gap; `pnpm typecheck` is the only static gate over the non-web packages (incl. task A's `packages/shared/src/plans.ts`), and it passed. `pnpm --filter shared test` 39 files / 571 tests passed, exit 0; `pnpm --filter web test` 63 files / 601 tests passed, exit 0. Full logs captured (see Evidence Log). |
| Integration chains traced | All 5 (below), each confirmed by reading final source with file:line citations — no chain broken, no hardcoded "pro" regression found anywhere outside a display-label ternary. |
| Cross-task scope integrity | Confirmed: task A (`plans.ts` — max entry, `isPaidPlan`), task B (`billing.ts`/`billing-core.ts`/`env.ts` — Stripe max wiring), task C (8 identity-gate sites using `isPaidPlan`), task D (`invites-core.ts` + both invite routes + `team-settings.tsx` upsell modal), task E (`pricing-cards.tsx` 3-tier + `billing/page.tsx` max copy) all coexist simultaneously in the final files — verified by reading the live files (not diffs), each showing evidence of multiple tasks' edits at once (e.g. `billing/page.tsx` imports `isPaidPlan` (C) *and* branches on `plan.id === "max"` for copy (E) *and* passes `isPaid` to `BillingManager` (C) in the same function). |
| Out-of-scope items (not flagged) | OSD-001 (report-tokens.ts JSDoc "16 bytes entropie" cosmetic mismatch — pre-existing, phase-1), OSD-002 (pre-existing sites-manager.tsx upsell-shape quirk), `features.seats ?? maxMembers` not test-discriminable for max (plans.max seats===maxMembers===3, disclosed data coincidence per MFL-017), migration 026 not applied to a live DB (Docker off, statically validated), `STRIPE_PRICE_MAX` unset in real envs (env-driven, expected pre-deploy). |
| FAST-PATH ELIGIBLE | **YES** — synthesis is independent, full suite passed, no orchestrator investigation needed. |

---

## Evidence Log

### Full-suite verification (run by this auditor, repo root, uncommitted main)

```
pnpm typecheck
  Scope: 8 of 9 workspace projects
  packages/db typecheck: Done
  packages/shared typecheck: Done
  packages/mcp-server typecheck: Done
  packages/notify typecheck: Done
  packages/scan-core typecheck: Done
  apps/scheduler typecheck: Done
  apps/web typecheck: Done
  apps/worker typecheck: Done
  EXIT: 0

pnpm lint
  > pnpm --filter web lint  (root script forwards to apps/web only — repo-wide by design
  > has no lint step for the other 8 packages, confirmed via package.json inspection)
  > @scanpal/web@0.1.0 lint  (eslint)
  EXIT: 0

pnpm --filter shared test
  Test Files  39 passed (39)
  Tests       571 passed (571)
  EXIT: 0
  (includes plans.test.ts — 14 tests)

pnpm --filter web test
  Test Files  63 passed (63)
  Tests       601 passed (601)
  EXIT: 0
  (stderr blocks present in the log are expected error-path assertions the tests
   themselves trigger — e.g. "database kapot", "stripe kapot" — not failures; every
   file shows a green ✓ file-level summary line)
```

No skipped/pending tests observed. No `EXIT` non-zero anywhere.

### Chain 1 — Checkout→webhook→plan→gates (B→C)

- `packages/shared/src/plans.ts:77-94` — `max` plan entry: `maxMembers: 3`, `features.seats: 3`,
  `features.white_label: true`, all other features `true`.
- `packages/shared/src/plans.ts:100` — `export const isPaidPlan = (id: PlanId): boolean => id !== "free";`
- `apps/web/lib/billing.ts:24-32` — `resolvePlanFromPrice`: pro-price branch unchanged, **new**
  `if (priceId && (priceId === env.stripePriceMax || priceId === env.stripePriceMaxAnnual)) return "max";`.
- `apps/web/lib/billing.ts:42-86` `createCheckoutSession`: price selection branches
  `input.planId === "max" ? (…env.stripePriceMax[Annual]) : (…env.stripePricePro[Annual])` (:47-54);
  `metadata: { team_id, plan_id: input.planId, interval }` sent on both session and
  subscription_data (:68,70) — so a max checkout's Stripe metadata carries `plan_id: "max"`.
- `apps/web/lib/billing-core.ts:100-130` (`handleCheckoutCompleted`, read in full) — webhook plan
  source: `const parsedPlan = planIdSchema.safeParse(object.metadata?.plan_id); const plan: PlanId =
  parsedPlan.success ? parsedPlan.data : "pro";` (:109-110), default `"pro"` only when parse
  fails/absent (legacy events) — **no longer hardcoded "pro"**. Confirmed the parsed `plan` is
  actually **written**, not just declared: it is bound as the `$2` parameter of the
  `insert into subscriptions (team_id, plan, ...) values ($1, $2, ...) on conflict (team_id) do
  update set plan = excluded.plan, ...` (:112-129) — so a max checkout's webhook genuinely persists
  `plan = 'max'` on both first-insert and re-upsert paths, not merely computes it.
- `apps/web/lib/env.ts:17-23,55-58` — `STRIPE_PRICE_MAX`/`STRIPE_PRICE_MAX_ANNUAL` defined
  alongside the pro vars, same `.optional()` shape, exported as `stripePriceMax`/`stripePriceMaxAnnual`.
- `apps/web/app/api/billing/subscription/route.ts` PATCH handler passes `subscription.plan`
  (from `getSubscriptionState`) into `switchSubscriptionInterval(id, interval, subscription.plan)`
  — confirmed via grep (3 call-site lines) — so an interval switch on a Max subscription stays on
  Max prices, never falls back to pro.
- The 8 identity-gate sites (MFL-008) — all confirmed switched to `isPaidPlan(plan.id)`, **zero**
  remaining `plan.id === "pro"` / `!== "pro"` gates in non-test source:
  1. `apps/web/app/(dashboard)/billing/page.tsx:6,35` `isPaid = isPaidPlan(plan.id)`
  2. `apps/web/components/billing-manager.tsx:17,21,88-89` `isPaid` prop (renamed from `isPro`)
  3. `apps/web/app/api/threats/route.ts:31` `if (!isPaidPlan(plan.id))`
  4. `apps/web/app/api/threats/events/route.ts:32` same
  5. `apps/web/app/api/sites/[id]/honeypot/route.ts:36` same
  6. `apps/web/app/api/sites/[id]/schedule/route.ts:46` same
  7. `apps/web/app/(dashboard)/threats/page.tsx:42` same
  8. `apps/web/app/(dashboard)/sites/page.tsx:38` `schedulingEnabled={isPaidPlan(plan.id)}`
  Repo-wide grep `=== "pro"|!== "pro"|isPro\b` over `apps/web/**/*.{ts,tsx}` excluding tests →
  exactly one hit, `team-settings.tsx:306`, which is a **display-label ternary**
  (`` `Upgrade naar ${upsell.plan === "pro" ? "Pro" : upsell.plan}` ``), not a gate — harmless since
  `nextPlanForMemberLimit` (chain 2) only ever returns `"pro"` or `null`.
- **Verdict: chain intact.** A max checkout → metadata plan_id="max" → webhook writes plan "max" →
  `isPaidPlan("max") === true` → all 8 gates open for max. No link hardcodes "pro".

### Chain 2 — Invite upsell→checkout (D→B)

- `apps/web/lib/invites-core.ts:67-77` `maxMembersForTeam`: `plan.features.seats ?? plan.maxMembers`
  — the exact limit-source decision (MFL-010 dec. 5).
- `apps/web/lib/invites-core.ts:86-88` `nextPlanForMemberLimit`: `planId === "free" ? "pro" : null`
  — free→pro; pro/max → `null` (no upsell key).
- `apps/web/app/api/teams/[teamId]/invitations/route.ts:57-68`: on `member_limit`, looks up the
  team's current plan via `getPlanForTeam`, computes `nextPlan`, returns
  `NextResponse.json({ error, ...(nextPlan ? { upsell: { plan: nextPlan, feature: "seats" } } : {}) }, { status: 409 })`.
  Confirms: **free at limit → 409 + `upsell.plan: "pro"`; pro/max at limit → 409 with no `upsell` key
  at all** (object spread conditionally omits it) — no dangling upsell to a nonexistent tier.
- `apps/web/app/api/invitations/[token]/accept/route.ts:35-36` — `member_limit` → 409, no upsell
  payload (accepter isn't necessarily the owner) — consistent status code, correct no-upsell shape.
- `apps/web/components/team-settings.tsx:66-67,85-88`: client reads `data?.upsell` (only present
  for the free→pro case), then `POST /api/billing/checkout` with `body: JSON.stringify({ planId: upsell?.plan ?? "pro" })`.
- **Checkout entry point read directly (not inferred from the discovery spec)**:
  `apps/web/app/api/billing/checkout/route.ts:1-27` — validates the POST body with
  `billingCheckoutSchema.safeParse(body)`, rejects only `parsed.data.planId === "free"` (:22-27);
  everything else (pro, max) proceeds to `createCheckoutSession`. `packages/shared/src/billing.ts:2,9-11`
  confirms `billingCheckoutSchema = z.object({ planId: planIdSchema, ... })` — `planId` is typed
  directly off the same `planIdSchema` task A extended to include `"max"`, not a separate/stale
  literal enum. So the client's `{planId:"pro"}` POST (and any future `{planId:"max"}` POST) both
  validate and reach the real Stripe branch traced in chain 1 — **the upsell target is a genuine,
  working checkout path, not a dead-end.**
- **`getPlanForTeam` read directly** (the function that resolves "current plan" for the
  409-response's `nextPlan` computation): `packages/scan-core/src/credits.ts:60-66` —
  `const state = await getSubscriptionState(db, teamId); return plans[state?.plan ?? "free"];` —
  `getSubscriptionState` does a live `select ... from subscriptions where team_id = $1` (same file,
  :40-57), so it returns the team's **actual current plan row**, defaulting to `"free"` only when no
  subscription row exists at all (new team). A max team therefore resolves `plan.id === "max"` here,
  `nextPlanForMemberLimit("max")` returns `null` (invites-core.ts:87), and the invitations route's
  conditional spread (`...(nextPlan ? {...} : {})`) omits the `upsell` key entirely — confirming
  "pro/max at limit get 409 with NO upsell" from the actual resolving function, not just the
  literal-mapping helper.
- **Verdict: chain intact.** Free-at-limit → 409 + upsell:pro → client modal → real pro checkout.
  Pro/max-at-limit → 409, no upsell affordance shown (client only renders the modal when
  `data?.upsell` exists, and the server never sends that key for pro/max).

### Chain 3 — Seat definition (A+D) + downgrade semantics

- Max seat limit resolves to 3: `plans.max.features.seats = 3` (plans.ts:91) via
  `plan.features.seats ?? plan.maxMembers` (invites-core.ts:77) → 3. Free/pro: `features.seats: null`
  for both (plans.ts:55,73) → falls back to `maxMembers` (free 3, pro 10) — **unchanged from
  pre-plan-64 numeric limits**, confirmed by reading both plan records directly (no diff needed;
  values read from live file).
- Downgrade path: plan changes flow **only** through
  `apps/web/lib/billing-core.ts:132-186` `handleSubscriptionEvent`, which `UPDATE subscriptions SET
  plan = $2 …` (only column touched besides status/interval/customer/subscription-id) — it never
  references the `memberships` table. Grepped `delete from memberships` and `removeMember(` across
  non-test `apps/web` source: the only caller of `removeMember` is the explicit owner-initiated
  `DELETE /api/teams/[teamId]/members/[userId]` route (`route.ts:56`) — a manual, unrelated action.
  **No code path deletes members as a side effect of a plan/subscription change.** This is the
  pre-plan-64 behavior, unmodified — matches the acceptance criterion ("downgrade werkt: actieve
  members vallen niet weg").
- "Invites just stop" on downgrade: mechanically true because `maxMembersForTeam` re-reads the
  *current* plan on every invite attempt (invites-core.ts:71-75) — once a downgraded team's seat
  count ≥ the new (lower) limit, the next `createInvitation` call throws `member_limit` → 409,
  with no membership rows touched.
- **Verdict: chain intact.** Seat numbers correct (3/10/3), no member-deletion regression.

### Chain 4 — UI truthfulness (A+E)

- `apps/web/app/api/plans/route.ts`: `planList.map((p) => publicPlanSchema.parse(p))` → returns
  exactly 3 plans (free/pro/max), each schema-validated including the new `seats`/`white_label`
  feature fields.
- `apps/web/components/pricing-cards.tsx:87` — `grid gap-6 md:grid-cols-3` (3-column grid, one
  card per `plans` array entry — driven by the same 3-entry `planList`).
- `pricing-cards.tsx:129-131` — seats row: `plan.features.seats !== null ? `${plan.features.seats}
  betaalde seats` : `Maximaal ${plan.maxMembers} teamleden`` — max card truthfully shows "3 betaalde
  seats"; free/pro show member-count copy (features.seats is null for both, unchanged).
  `pricing-cards.tsx:145-150` — white-label row renders ✓ only when `plan.features.white_label`
  (true only for max).
  Each plan card has its **own** `checkout(plan.id)` button (:181-188) — no cross-tier "upgrade
  seats" affordance from pro→max anywhere in this component (confirmed by reading the full file:
  the only upsell-shaped UI in the app that references seats is the invite-limit modal in
  `team-settings.tsx`, which — per chain 2 — only ever offers "pro", never "max").
- `apps/web/app/(dashboard)/billing/page.tsx:66-70` — max-specific copy branch:
  `` `${plan.creditsPerPeriod} scans per … · ${plan.features.seats ?? plan.maxMembers} betaalde
  seats · white-label branding` `` shown only when `plan.id === "max"`.
- **Exhaustive `upsell` grep (not just the two files read above)**: `grep -in upsell` over
  `apps/web/**/*.{ts,tsx}` (non-test) returns every upsell-shaped payload in the app —
  `apps/web/app/api/onboarding/sites/route.ts:87`, `.../threats/route.ts:35`,
  `.../threats/events/route.ts:36`, `.../sites/[id]/schedule/route.ts:50`,
  `.../sites/[id]/route.ts:112`, `.../sites/[id]/honeypot/route.ts:40`, `.../sites/route.ts:82`,
  `.../scans/route.ts:53,93` — **every one of these literal server payloads is `upsell: { plan: "pro" }`**,
  none is `"max"`. The single dynamic one, `apps/web/app/api/teams/[teamId]/invitations/route.ts:65`
  (`upsell: { plan: nextPlan, ... }`), is bounded to `"pro" | null` by `nextPlanForMemberLimit`
  (chain 2) — it can never emit `"max"`. Client-side consumers (`sites-manager.tsx`,
  `scan-result.tsx`, `onboarding-wizard.tsx`, `team-settings.tsx`) all default
  `upsell?.plan ?? "pro"` on checkout POST. Test suite additionally locks this behaviorally:
  `apps/web/lib/__tests__/invites-core.test.ts:577` ("heeft geen upsell voor het Max-plan…") and
  `apps/web/lib/__tests__/invitations-route.test.ts:103` ("geeft 409 ZONDER upsell terug wanneer een
  Max-team de seats-limiet raakt") — both green in the verified 601/601 web run.
- **Verdict: chain intact.** 3 tiers everywhere consistently (API, pricing page, billing page); max
  truthfully advertises 3 seats + white-label; exhaustive grep + passing behavioral tests confirm no
  pro→max upsell affordance exists anywhere in the app.

### Chain 5 — Cross-task scope integrity

Verified by reading the **final, live** versions of every file each task touched (not diffs) and
confirming multiple tasks' signatures appear together in the same file simultaneously:
- `packages/shared/src/plans.ts` — task A's `max` entry + `isPaidPlan` helper (used by task C) live
  in the same file the plan record that task B's `resolvePlanFromPrice`/`createCheckoutSession`
  index into and that task D's `maxMembersForTeam` reads `.features.seats` from, and that task E's
  `pricing-cards.tsx`/`/api/plans` render — single source of truth, no fork.
- `apps/web/app/(dashboard)/billing/page.tsx` — imports `isPaidPlan` (task C) **and** contains the
  `plan.id === "max"` copy branch (task E) **and** passes `isPaid` to `BillingManager` (task C's
  prop rename) all in the same ~40-line block — confirms C and E coexist without one overwriting
  the other.
- `apps/web/app/api/teams/[teamId]/invitations/route.ts` — task D's full 409+upsell logic present
  and unconflicted with any other task's territory (this route is D-exclusive).
- `apps/web/lib/billing.ts` / `billing-core.ts` / `env.ts` — task B's max price/webhook wiring
  present in full (both files read in full above, not just grepped), and untouched by C/D/E —
  neither file references `isPaidPlan` or `features.seats`; they stay Stripe-mechanics-only as
  designed.
- Per the MFL log (MFL-011, -013/015, -016, -017, -018), each task's own independent reviewer
  additionally ran a SHA-256 scope-baseline compare proving *only* that task's declared files
  changed relative to the pre-task baseline; this auditor's live-file read cross-validates that
  those additive deltas landed in the same final files without one task's edits clobbering
  another's (e.g. `pricing-cards.tsx` retains task C's byte-identical upsell-target code per MFL-018
  while carrying task E's 3-column/seats-row changes — confirmed directly by reading the current
  file, which shows both).
- **Verdict: intact.** No task overwrote another's accepted change; all 5 tasks' work coexists in
  the final source.

---

## Non-blocking notes (recorded, not gate-blocking, per task.md's out-of-scope list)

1. OSD-001 — `packages/shared/src/report-tokens.ts` JSDoc says "16 bytes entropie" but the
   generator yields ~122 bits (~15.25 bytes) via UUID-derivation (MFL-006/007/009). Cosmetic,
   pre-existing from phase-1, unrelated to phase-2's billing/seat work.
2. OSD-002 — pre-existing `sites-manager.tsx` upsell-shape quirk, unrelated to phase-2 (task D's
   `team-settings.tsx` modal was independently verified to read the *real* `data.upsell.plan` shape
   and does not reproduce this quirk — MFL-017).
3. `features.seats ?? maxMembers` is not test-discriminable for the max plan today because
   `plans.max.maxMembers === plans.max.features.seats === 3` — a disclosed data coincidence
   (MFL-010 dec. 5, MFL-017), not a code defect; the `??` operator is exercised for free/pro where
   `features.seats` is `null`.
4. Migration 026 (`teams.branding`, `workspaces`, `plan` check constraint incl. `'max'`) was only
   statically validated in phase-1 (Docker unavailable) — re-verify at the first real
   `pnpm db:migrate`. Not phase-2's responsibility.
5. `STRIPE_PRICE_MAX`/`STRIPE_PRICE_MAX_ANNUAL` are unset in real deployment environments today —
   expected and env-driven identically to the pro price vars; will be set at deploy time.

No other findings. No blocking integration breaks identified.

---

AUDIT: READY

FAST-PATH ELIGIBLE: YES

Report: `C:/Users/Yassin/Desktop/scanpal/ScanPal/DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-2/phase-2-audit/phase-audit.md`
