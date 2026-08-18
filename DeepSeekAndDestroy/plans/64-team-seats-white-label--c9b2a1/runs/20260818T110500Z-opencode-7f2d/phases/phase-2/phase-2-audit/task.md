# Phase-2 Hard Gate — Phase Auditor (fresh, Sonnet 5)

You are the PHASE AUDITOR for phase-2 of plan `64-team-seats-white-label` (step 2: wire the **max**
plan through billing + change the invite seat-limit to 409 + upsell). All 5 tasks (A–E) already passed
independent review. Your job is PLAN-WIDE INTEGRATION synthesis + a full-suite verification class, NOT
re-reviewing each task line-by-line. You did not implement any of it. Establish facts from source + real
command runs.

Repo root: C:/Users/Yassin/Desktop/scanpal/ScanPal (git, branch `main`; works on UNCOMMITTED main — a
large pre-existing accepted baseline from other plans + phase-1 exists; do NOT flag those).

## Authority to check against
- Plan: `docs/plans/64-team-seats-white-label.md` — step 2 + acceptance criterion:
  "Max-plan heeft 3 seats; invite bij limiet → 409 + upsell; downgrade werkt (actieve members vallen
  niet weg, invites stoppen)."
- Decisions: `DeepSeekAndDestroy/.../major-findings-and-fixes.md` MFL-20260818-008/010/011/013/015/016/017/018.
- Discovery spec (the construction contract): `.../phase-2/phase-2-billing-discovery-6e0b/discovery-spec.md`.
- Accepted task reports/reviews under `.../phase-2/phase-2-task-{A,B,C,D,E}-*/` (implementer-report.md + review-1.md).

## What phase-2 was supposed to deliver (tasks A–E)
- A: shared max contract (planIdSchema/plans/planList + features.seats/white_label).
- B: Stripe wiring — STRIPE_PRICE_MAX env, resolvePlanFromPrice→"max", plan-aware createCheckoutSession
  + switchSubscriptionInterval, webhook handleCheckoutCompleted reads metadata.plan_id (default "pro").
- C: `isPaidPlan` broadens the 8 plan-identity feature gates so max unlocks pro-only features.
- D: invite seat-limit → 409 + upsell (free→pro; pro/max no upsell), limit = features.seats ?? maxMembers;
  accept route 409; client upsell modal.
- E: 3-tier pricing UI + max-aware billing copy + /api/plans returns 3 plans.

## INTEGRATION checks (the real point of this gate — trace the chains, cite file:line)
1. **Checkout→webhook→plan→gates chain (B→C):** a user checks out the max plan → `createCheckoutSession`
   sends metadata.plan_id="max" and the max Stripe price → webhook `handleCheckoutCompleted` writes
   plan="max" → the 8 gates (`isPaidPlan("max")===true`) open. Confirm each link exists and is consistent
   (no link still hardcodes "pro"). Confirm `resolvePlanFromPrice` maps the max price → "max".
2. **Invite upsell→checkout chain (D→B):** a free team at its 3-seat limit gets 409 +
   `upsell:{plan:"pro"}` → the client modal POSTs `{planId:"pro"}` to /api/billing/checkout → that
   resolves to the pro price. Confirm the upsell target actually corresponds to a real checkout path.
   Confirm pro/max at limit get 409 with NO upsell (no dangling upsell to a nonexistent tier).
3. **Seat definition (A+D):** max seat limit resolves to 3 via features.seats; free/pro numeric limits
   unchanged (3/10). Downgrade semantics: active memberships are NOT removed, invites just stop
   (verify no code path deletes members on plan change — should be unchanged from before plan-64).
4. **UI truthfulness (A+E):** pricing shows 3 tiers; max card shows 3 seats + white-label; /api/plans
   returns 3 plans; no pro→max "more seats" upsell affordance anywhere.
5. **Cross-task scope integrity:** the 5 tasks did not overwrite each other (e.g. task-E's billing/page
   copy vs task-C's isPaid gate; task-D invite vs task-C gates). Confirm the final files contain ALL of
   each task's accepted changes simultaneously.

## Verification class to RUN yourself (full repo suite, real output)
```
pnpm typecheck        # all 8 packages
pnpm lint             # repo-wide
pnpm --filter shared test
pnpm --filter web test
```
Report exact counts. (vitest rooted at apps/web → app-relative paths if you target files.)

## Out-of-scope (do NOT fail the gate for these — note only)
- OSD-001 (report-tokens JSDoc cosmetic), OSD-002 (pre-existing sites-manager.tsx upsell-shape quirk).
- The known accepted limitation that `features.seats ?? maxMembers` is not test-discriminable for max
  (plans.max seats===maxMembers===3).
- Migration 026 not applied to a live DB (Docker off) — static-validated in phase-1, re-verified at first
  real `pnpm db:migrate`.
- STRIPE_PRICE_MAX unset in real envs (env-driven, same as pro) — expected until deploy.

## Report
Write `phase-audit.md` in `.../phases/phase-2/phase-2-audit/` with a Decision Packet + evidence log +
one line on its own: `AUDIT: READY` (phase can be approved) or `AUDIT: BLOCKED` (with a numbered list of
blocking findings: file:location, the integration break, why it matters, exact fix). Mark
`FAST-PATH ELIGIBLE: YES` if your synthesis is independent, the full suite passed, and no orchestrator
investigation is needed. Read-only: no source edits, no commit, no destructive git, edit no
DeepSeekAndDestroy file except phase-audit.md. End with the AUDIT line + report path.
