# Major Findings and Fixes — Run 20260818T110500Z-opencode-7f2d

_Append-only engineering rationale log._

## MFL-20260818-001 — Plan 64 claim "invite-route kent geen seat-limiet" is FALSE

- **What**: The plan's "Uitgangssituatie" states the invite route has no seat limit. It does: `apps/web/lib/invites-core.ts:62-87` (`maxMembersForTeam` reads `subscriptions.plan` and returns `plans[planId].maxMembers`; `assertSeatAvailable` throws `InviteError("member_limit")`), invoked by `createInvitation` (`:117-129`, seats = accepted memberships + unexpired pending invites) and `acceptInvitation` (`:197-204`, seats = accepted memberships only). Covered by tests `apps/web/lib/__tests__/invites-core.test.ts:295-311` and `:382-394`.
- **Why it matters**: Plan step 2 ("Seat-check in de invite-route + upsell-payload") is therefore a *modification* of existing behavior, not net-new work. Today `member_limit` maps to HTTP 400 with no upsell (`apps/web/app/api/teams/[teamId]/invitations/route.ts:56-60`), so step 2's real scope is: add the 409 + `upsell` payload, add `seats`/`white_label` feature flags and a `max` plan (which does not exist anywhere — DB check `003:8`, `planIdSchema` `packages/shared/src/plans.ts:3`, Stripe resolution `apps/web/lib/billing.ts:24-29`, webhook plan-sync `apps/web/lib/billing-core.ts:107,147`).
- **Engineering rationale**: No code was changed (read-only survey). The correct seat-limit contract (409 + upsell, Max=3 seats) must be layered onto the existing `member_limit` mechanism, and the `maxMembers` semantics (owner counted, pending counted on create but not on accept) stay as the plan's open "seats-definition" question.
- **Verification**: grep `seats|member_limit|maxMembers` across `apps/web` + `packages/*`; full read of `invites-core.ts` and its test file; read of the invite POST route.
- **Remaining risk**: The plan's step-2 acceptance criteria ("Max-plan heeft 3 seats; invite bij limiet → 409 + upsell") will silently regress if implemented as net-new instead of modifying the existing path; tests must assert 409 + upsell, not just the `member_limit` code.

## MFL-20260818-002 — Report content/export API moved: `[id]/content` deleted, `[scanId]/content` untracked

- **What**: `apps/web/app/api/reports/[id]/content/route.ts` is deleted in the working tree (git `D`); a new untracked `apps/web/app/api/reports/[scanId]/content/route.ts` has identical logic (`git show HEAD:…/[id]/content/route.ts` compared), only the param name changed — and the new route still forwards it as `reportId` to `getReportContent` (`apps/web/lib/report/store.ts:127-141`). Tests updated (6-line diff in `apps/web/lib/__tests__/report-content-route.test.ts`). `apps/web/AGENTS.md` route table and `apps/web/app/api/reports/[scanId]/route.ts` (generation, tracked) + `apps/web/app/api/reports/route.ts` (history, tracked) already reflect the new path.
- **Why it matters**: The survey question asked where the report content/export API actually is; both the AGENTS.md index and the survey task listed the stale `[id]/content` path. Downstream readers (and plan 64 step 3, which extends the renderer with branding) must target `[scanId]/content` for stored downloads and `[scanId]/route.ts` for generation.
- **Engineering rationale**: None needed — this is pre-existing uncommitted work treated as the accepted baseline. Flagged so plan 64 task units reference the live path.
- **Verification**: `git status --short` (D row + `?? apps/web/app/api/reports/[scanId]/content/`), `git show HEAD:apps/web/app/api/reports/[id]/content/route.ts` vs current file, glob of `apps/web/app/api/reports/**`.
- **Remaining risk**: Param naming (`[scanId]` used as a report-id in `content` route) is misleading but behavior-preserving; do not "fix" the name to a real scan-id without also changing `getReportContent` semantics — out of scope for plan 64.

## MFL-20260818-003 — Orchestrator decisions on plan 64 open questions (seats, token, workspace roles)
- Time: 2026-08-18T12:00:00Z
- Actor / role: main orchestrator
- Phase / task / review round: phase-1 decomposition
- Type: decision
- Status: fixed (recorded)
- Related entries: MFL-20260818-001
- Decisions:
  1. **Seats-definition**: "actief" = accepted memberships; the team owner counts (owner is an accepted membership). Limit source = `plan.features.seats ?? plan.maxMembers` (Max: seats=3; free=3 / pro=10 keep maxMembers). No change to counting semantics — only limit source and error shape (400 → 409 + upsell) change.
  2. **Report-token**: per-scan (not per-site). Stored as `scans.report_token` + `scans.report_token_expires_at` (nullable) with a partial unique index — mirrors `sites.public_status_slug` precedent (migration 019). Token = 32 hex chars (`randomBytes(16)`), generated on-demand via a team-authenticated share endpoint; expiry optional. Site-overview portal: out of scope.
  3. **Workspace roles**: one role (member) per workspace — no workspace-level roles. `memberships.workspace_id uuid null` FK; unassigned members see no sites; team owner sees all sites. Workspace assignment = updating `memberships.workspace_id` via owner-only workspace-member endpoints.
- Alternatives considered: `report_tokens` table (rejected: extra table for one nullable column pair; scans-column pattern matches 019); `workspace_members` join table (rejected: plan language is singular "de eigen workspace"; one workspace per member keeps scoping linear); workspace-level owner/member roles (rejected: plan decision 3/6 — workspaces are an org structure, not a billing/permission entity).
- Verification: survey evidence (plan 64 contract lines 9-14, plans.ts, 019 migration, invites-core counting).
- Remaining risks: unassigned members see zero sites — must be explicit in UI copy and tests; free/pro upgrade path (free→pro) keeps working while max becomes the new ceiling.

## MFL-20260818-010 — Phase-2 decisions (from billing discovery spec)
- Time: 2026-08-18T14:10:00Z
- Actor / role: main orchestrator
- Phase / task / review round: phase-2 decomposition
- Type: decision
- Status: fixed (recorded)
- Related entries: MFL-20260818-001, MFL-20260818-003, MFL-20260818-005
- Decisions (resolution of discovery-spec §2 open points):
  1. **Upsell next-plan for member_limit**: helper `nextPlanForMemberLimit(planId)`: free → "pro"; pro → null; max → null (max seats 3 < pro maxMembers 10, so no higher member tier exists — pro/max get 409 without upsell key). Upsell payload only when nextPlan exists: `{ error, upsell: { plan, feature: "seats" } }`.
  2. **handleCheckoutCompleted**: validate `metadata.plan_id` against `planIdSchema`, default "pro" for legacy events lacking/invalid plan_id (preserves current behavior).
  3. **Accept route member_limit**: 400 → 409 (no upsell payload; accepter is not necessarily owner).
  4. **Max display pricing**: display-only values — `priceCents = pro.priceCents * 4`, `annualPriceCents = pro.annualPriceCents * 4`; real prices live in Stripe env (`STRIPE_PRICE_MAX`(+`_ANNUAL`)). creditsPerPeriod 2000, apiRatePerMinute 240, maxWebhooks = pro's value (read from plans.ts). Implementer must read the actual pro numbers and report them.
  5. **maxMembers for max**: 3 (== features.seats; single source of truth); limit source stays `features.seats ?? maxMembers`.
- Phase-1 gate: APPROVED by orchestrator (auditor AUDIT: READY, 0 blocking findings, FAST-PATH YES). Non-blocking: (a) 026 only statically validated (Docker off) — first real `pnpm db:migrate` re-verifies; (b) cosmetic JSDoc "16 bytes entropie" in report-tokens.ts — queued for phase-6 sweep (defect ledger).
- Verification: discovery-spec §1-2 (cited file:line); phase-1 phase-audit.
- Remaining risks: pricing-cards UI must handle 3 tiers (grid/CTA); pro→max upsell absent by design — any UI that suggested it would be wrong; feature gates (threats/honeypot/schedule) must open for max via isPaidPlan (MFL-008).

## MFL-20260818-011 — Reviewer (round 1) verification of phase-2-task-A (max plan contract): PASS, MFL-005 index hazard resolved
- Time: 2026-08-18
- Actor / role: reviewer (phase-2-task-A-plans-max-3b8a), round 1
- Phase / task: phase-2, task-A (shared plans contract: max plan)
- Type: verification note
- Status: recorded
- Related entries: MFL-20260818-005, MFL-20260818-008, MFL-20260818-010
- What: independently re-derived (did not trust the implementer report):
  1. **Scope**: SHA-256 compare over all 40 scope-baseline.json files → exactly 1 mismatch, `packages/shared/src/plans.ts` (`AA835C05…` → `D84A5E70…`); index.ts (`D9F5D3E3…`) and all 38 pre-existing shared test files byte-identical; `plans.test.ts` absent from the baseline map (the task's only new file). `git status` delta vs changed-paths-inventory.txt = exactly the 2 declared paths.
  2. **Values**: planIdSchema `["free","pro","max"]`; max seats 3 / white_label true / maxMembers 3 / credits 2000 / api 240 / webhooks 3 (pro's value); priceCents 11600 = pro 2900×4; annualPriceCents 116000 = pro 29000×4 (pro's annual present — arithmetic correct). free/pro existing values preserved, only additive seats null / white_label false. planList 3 entries; publicPlanSchema mirrors seats/white_label and parses the max shape (test asserts parsed values, not just success).
  3. **MFL-005 resolution**: the `plans['max'] → undefined` hazard at `scan-core/src/credits.ts:43,83`, `scheduler/src/credits.ts:48`, `web/lib/invites-core.ts:71` is now resolved — `plans` is exhaustive over `Record<PlanId, Plan>` (typecheck-enforced), so indexing by a `'max'` subscription can no longer return undefined.
  4. **Consumers**: only forward-looking adaptations, no breaks: pricing page renders a 3rd card (task E); checkout schema accepts max but `createCheckoutSession` still charges the pro price / `resolvePlanFromPrice` returns null for max prices (task B); GET /api/plans now returns 3 plans with the new feature fields (consumers assert only `length > 0` or ignore new fields).
  5. **Verification**: `pnpm --filter @scanpal/shared test` 39 files / 568 tests (plans.test.ts 11); root `pnpm typecheck` exit 0; `pnpm lint` exit 0; consumer greps `planList|publicPlanSchema|planIdSchema|plans\[` across packages/apps.
- Why it matters: closes the phase-1 forward-compat gap (MFL-005) with the exhaustive plans record, and confirms the shared contract is ready for task B's billing wiring (which must add Stripe price mapping + the identity-gate broadening from MFL-008).
- Engineering rationale: none beyond recording the reviewer verdict and the residual, explicitly-deferred wiring (tasks B/E) so later tasks know the exact integration points.
- Verification: see review-1.md (evidence paths) — all command outputs recorded there.
- Remaining risk: none task-relevant. Checkout for "max" currently charges the pro Stripe price (metadata `plan_id=max`); the first real max checkout must land together with task B's price mapping or a Max user would be over/under-charged — flag for task B.

## MFL-20260818-004 — Phase-1 task-1 (migration 026): Docker unavailable → static verification; baseline `src/index.ts` already carried plan-62 `crux` edit
- Time: 2026-08-18
- Actor / role: implementer (phase-1-task-1-migration-026-4f7b)
- Phase / task: phase-1, task-1 (migration 026 + db types)
- Type: verification / preservation note
- Status: recorded
- Related entries: MFL-20260818-003 (token decision implemented here as `scans.report_token` + `scans.report_token_expires_at` + partial unique `scans_report_token_key`, matching decision 2)
- What:
  1. Acceptance criterion 1 allows throwaway-container validation "if Docker is available". `docker version` fails (daemon not running: "failed to connect to the docker API at npipe://…dockerDesktopLinuxEngine"), `psql` not installed, and no offline PG parser exists in node_modules — so SQL validation was static (each statement mirrored against the applied-style statements in 001/003/006/012/019/025) + full-workspace typecheck. No real DB was touched per the task exclusion.
  2. `packages/db/src/index.ts` already had a pre-existing uncommitted baseline edit (plan-62 `crux` field on `ScanRow`, confirmed via `git diff`). The migration-026 edits were layered additively on top; the baseline edit is preserved.
- Why it matters: downstream plan-64 steps (2–5) build on `teams.branding`, `workspaces`, `workspace_id` (sites+memberships), `scans.report_token` and plan `'max'`; a silent baseline overwrite or a constraint-name mismatch would have corrupted those contracts.
- Engineering rationale: constraint replacement uses PostgreSQL's deterministic auto-name `subscriptions_plan_check` (inline unnamed check on `subscriptions.plan` in 003) — drop + re-add preserves the name, keeps `('free','pro')`, appends `'max'`, matching 012's `drop constraint`/`add constraint` style. New `workspaces` table follows the no-RLS sites/scans precedent (024 enables RLS only on users/teams/memberships/subscriptions/api_keys).
- Verification: `pnpm typecheck` (8 packages), `pnpm --filter db typecheck`, `pnpm lint` all green; SHA-256 re-check vs scope-baseline.json shows only `src/index.ts` changed among baseline files plus new `026_team_seats_white_label.sql`; `git status --porcelain -- packages/db` matches baseline inventory + task file.
- Remaining risk: SQL not applied to a live server (Docker off). Residual apply-time failure risk is low (statements are direct mirrors of applied precedent) but non-zero; the first real `pnpm db:migrate` should re-verify.

## MFL-20260818-005 — Forward-compat contract gap: `packages/shared` planIdSchema has no 'max' while DB admits it (reviewer-confirmed, NOT a task defect)
- Time: 2026-08-18
- Actor / role: reviewer (phase-1-task-1-migration-026-4f7b), round 1
- Phase / task: phase-1, task-1 (migration 026 + db types)
- Type: verification note / forward-compat contract gap
- Status: recorded
- Related entries: MFL-20260818-001, MFL-20260818-003, MFL-20260818-004
- What: Post-026, the DB `subscriptions.plan` check admits 'max' and `packages/db/src/index.ts` `planIds` includes `"max"`, but `packages/shared/src/plans.ts:3` `planIdSchema = z.enum(["free","pro"])`, the `plans` record (:37-59), `planList` (:61), `publicPlanSchema` (:63) and `subscriptionSchema` (:85) still only know 'free'/'pro'. Reviewer re-derived the full consumer graph: the only `@scanpal/db` imports in the repo are `ApiKeyRow`/`ThreatHoneypotRow`/`ThreatRuleRow`/`WebhookRow`/`WebhookDeliveryRow` (none affected by this task); no code path writes 'max' to `subscriptions.plan` today (`ensureSubscriptionRow` writes 'free'; Stripe sync maps only free/pro prices), so the `plans['max']` → `undefined` index hazard in `packages/scan-core/src/credits.ts:43,83`, `apps/scheduler/src/credits.ts:48` and `apps/web/lib/invites-core.ts:71` is unreachable at runtime.
- Why it matters: the task explicitly defers `packages/shared` zod schemas to a separate unit (task.md: "packages/shared zod schemas are a separate task"), so this is a phased-delivery consequence, not a defect. But it is a hard ordering constraint: before any later phase can write a `'max'` row (billing/plan wiring), `planIdSchema`, the `plans` record, `planList`, `publicPlanSchema`/`subscriptionSchema`, and the invite-route upsell path must gain 'max' — otherwise `plans[planId].maxMembers` / `.creditsPerPeriod` throws on an undefined entry.
- Engineering rationale: none beyond ordering — record so the billing task (plan-64 step 2) lands `packages/shared` 'max' support first or in the same unit.
- Verification: rg over apps/packages for `planIdSchema|plans\[planId\]|maxMembers|planIds` and `@scanpal/db` imports; full read of plans.ts, credits.ts, invites-core.ts:60-90; root `pnpm typecheck` + `pnpm lint` green.
- Remaining risk: if a later phase writes 'max' to the DB before shared-plan support ships, `plans['max']` crashes at runtime — that phase must update shared first.

## MFL-20260818-006 — Report-token generation uses `crypto.randomUUID()` (global, v4-UUID) not `randomBytes(16)`; survey claim about public-status.ts was inaccurate
- Time: 2026-08-18
- Actor / role: implementer (phase-1-task-2-shared-schemas-9c2e)
- Phase / task: phase-1, task-2 (shared schemas)
- Type: decision / survey-correction
- Status: fixed (recorded)
- Related entries: MFL-20260818-003 (token decision 2: 32 hex chars)
- What:
  1. Task construction map prescribed `randomBytes(16).toString('hex')` via `node:crypto`, citing `public-status.ts:51-61` as using "crypto randomBytes". That file actually uses the **global** `crypto.randomUUID()` (no import) — the survey fact was wrong. Also, the environment's global `crypto` is typed as **only `{ randomUUID(): string }`** (`packages/shared/src/globals.d.ts`): a first implementation using `crypto.getRandomValues` failed `pnpm typecheck` with `TS2339: Property 'getRandomValues' does not exist on type '{ randomUUID(): string; }'`.
  2. Chosen implementation (`packages/shared/src/report-tokens.ts`): `generateReportToken()` = `crypto.randomUUID().replace(/-/g, "")` — the exact technique of the canonical `generatePublicStatusSlug` (`public-status.ts:51-56`). A v4 UUID is 32 lowercase hex chars; stripping hyphens yields exactly the 32-hex contract, 122 bits entropy (vs 128 for `randomBytes(16)`), same cryptographic family.
- Why it matters: `randomBytes`/`getRandomValues` are not type-available without adding `node:crypto`/lib-dom types to this dependency-free (zod-only) package; the UUID-derivative uses zero new imports and matches the house precedent byte-for-byte, so any future reviewer comparing against `public-status.ts` sees an identical pattern. Token length/format contract (32 lowercase hex, `isValidReportToken`) is unchanged and test-proven.
- Engineering rationale: convention over the literal prescription — the prescription's own cited precedent uses the UUID technique, and introducing a new import/type-surface into `packages/shared` would violate its "zod only" rule (AGENTS.md) for a 6-bit entropy difference on an already-unbrute-forceable token.
- Verification: first run failed typecheck (TS2339/TS18046 on `getRandomValues`); after the change, `pnpm typecheck` (8 packages) green, `pnpm --filter @scanpal/shared test` 557/557 green incl. 16 new report-token tests (32-hex format, 1000-call uniqueness, validator rejects wrong-length/uppercase/non-hex).
- Remaining risk: 122-bit entropy is marginally below the 128-bit decision text; acceptable for a single-scan share token. If the product ever wants strict 128-bit, switch to `node:crypto` `randomBytes` and add the type surface — no schema/format change needed.

## MFL-20260818-007 — Reviewer (round 1) independent re-verification of task-2: entropy deviation accepted; index.ts delta proven exactly 3 additive lines
- Time: 2026-08-18
- Actor / role: reviewer (phase-1-task-2-shared-schemas-9c2e), round 1
- Phase / task: phase-1, task-2 (shared schemas)
- Type: verification note
- Status: recorded
- Related entries: MFL-20260818-006
- What: Reviewer independently re-derived, without trusting the implementer report:
  1. **Token contract (MFL-006 judgment)**: direct runtime check (Node 24, no test runner) confirmed `generateReportToken()` output is always length-32 `^[0-9a-f]{32}$`, validates against `reportTokenSchema`, is unique across calls, and `isValidReportToken` accepts valid + rejects uppercase/non-hex/wrong-length. Plan-64 acceptance ("brute-force-proof", "32 lowercase hex") is met: 122-bit entropy (v4 UUID, 6 fixed bits) is >64-bit and unbrute-forceable; format contract unchanged. The deviation from the construction map's `randomBytes(16)` is justified (globals.d.ts types crypto as `{ randomUUID(): string }` only; house precedent public-status.ts uses the UUID technique; zod-only package rule). **No defect.**
  2. **index.ts delta**: reconstructing `packages/shared/src/index.ts` with the 3 lines `export * from "./branding|workspaces|report-tokens";` removed reproduces the scope-baseline hash `F9ED65B6…` byte-for-byte — the only change vs baseline is 3 additive export lines.
  3. **Scope**: SHA-256 compare vs scope-baseline.json → only `index.ts` changed among baseline files; 4 new files (`branding.ts`, `workspaces.ts`, `report-tokens.ts`, `__tests__/report-tokens.test.ts`); `plans.ts`/`public-status.ts`/`report.ts` byte-identical; `git status` delta vs baseline inventory is exactly those 4 new untracked paths.
- Verification: `pnpm --filter @scanpal/shared test` 38 files / 557 tests (report-tokens.test.ts 16) green; `pnpm typecheck` 8 packages green; `pnpm lint` green; direct node schema/helper probes; hash reconstruction.
- Remaining risk: none task-relevant.

## MFL-20260818-009 — Phase auditor (phase-1 hard gate): forward-compat schema gaps + cosmetic JSDoc note
_Note: originally written as MFL-20260818-008; renumbered to -009 on collision with a concurrently appended phase-2 entry that had also claimed -008._
- Time: 2026-08-18
- Actor / role: phase auditor (phase-1-audit-2d91), read-only
- Phase / task: phase-1 gate (plan 64 step 1)
- Type: verification note / forward-compat contract gaps (non-blocking)
- Status: recorded
- Related entries: MFL-20260818-005 (same pattern: shared zod schemas lag DB columns by design)
- What: independent audit confirmed zero consumers of the new DB columns/schemas (grep over apps + packages, non-test source: 0 hits), and identified two further forward-compat schema gaps beside the already-logged `'max'` gap: (1) `packages/shared/src/index.ts:22` `teamSchema` carries no `branding` while `teams.branding` now exists (phase 3 must extend it or compose `brandingSchema`); (2) `membershipSchema` (index.ts:29) and `teamMemberSchema` (index.ts:91) carry no `workspace_id` while `memberships.workspace_id` now exists (phase 4 must extend them for member-scoping). `siteSchema` (sites.ts:90) is a minimal shape, not a full-row mirror, so `sites.workspace_id` needs no immediate shared change. Also confirmed the `'max'` hazard sites are exactly credits.ts:43/83, scheduler/credits.ts:48, invites-core.ts:71 and that no source path writes `'max'` today.
- Cosmetic note: `report-tokens.ts:5,10` JSDoc says "16 bytes entropie" but the v4-UUID-derived generator yields 122 bits (~15.25 bytes); format contract (32 lowercase hex) unaffected — optional one-line comment fix later, not a defect.
- Engineering rationale: phased-delivery consequence, consistent with MFL-005; recorded so phases 3 and 4 extend the right shared schemas in the right unit instead of discovering the gap at runtime.
- Verification: SHA-256 scope re-derivation (task-1 27/28 OK + index.ts DIFF + 026 new; task-2 1 DIFF index.ts + 4 new files; plans.ts/public-status.ts/report.ts byte-identical), consumer greps, constraint-name check vs 003:8, run-log authenticity spot-check (38 files/557 tests, 8-pkg typecheck "Done" present in logs).
- Remaining risk: none blocking; live-PG apply of 026 still pending (Docker off) — verify at the next real `pnpm db:migrate`.

## MFL-20260818-008 — Paid-plan gates are plan-IDENTITY based (`plan.id === "pro"`), not feature-based — Max-plan wiring must broaden 8 sites
- Time: 2026-08-18
- Actor / role: discovery worker (phase-2-billing-discovery-6e0b)
- Phase / task: phase-2 (plan-64 step 2 — Max-plan billing wiring)
- Type: consequential decision / scope finding
- Status: recorded
- Related entries: MFL-20260818-001, MFL-20260818-005
- What: `grep 'plan\.id|=== "pro"|!== "pro"'` over `apps/web` shows paid-plan entitlement is gated by plan *identity* in 8 sites, NOT by `plan.features.*`:
  1. `apps/web/app/(dashboard)/billing/page.tsx:35` `isPro = plan.id === "pro"` (→ BillingManager prop, pro-only copy :66-70, payment-method/renewal rendering :70-87)
  2. `apps/web/components/billing-manager.tsx:17,21,88-89` `isPro` prop → manager actions only for pro
  3. `apps/web/app/api/threats/route.ts:31` `plan.id !== "pro"` → 403 + upsell
  4. `apps/web/app/api/threats/events/route.ts:32` `plan.id !== "pro"` → 403 + upsell
  5. `apps/web/app/api/sites/[id]/honeypot/route.ts:36` `plan.id !== "pro"` → 403 + upsell
  6. `apps/web/app/api/sites/[id]/schedule/route.ts:46` `plan.id !== "pro"` → 403 + upsell (`feature: "schedule"`)
  7. `apps/web/app/(dashboard)/threats/page.tsx:41` `plan.id !== "pro"` → ThreatsUpsell
  8. `apps/web/app/(dashboard)/sites/page.tsx:37` `schedulingEnabled={plan.id === "pro"}`
  The `features.*`-based gates (scans/route.ts:48 activeTests, sites/route.ts:76 + sites/[id]/route.ts:106 github, deploy-webhooks.ts:113 onDeploy) follow the Max-plan record automatically, but the identity gates do NOT: a `max` subscription row with all pro features true would still be blocked from scheduled scans, threats, and honeypot.
- Why it matters: "wire the max plan through the ENTIRE billing path" (plan 64 step 2) is not satisfied by `plans.ts` + Stripe mapping alone. The identity gates must become "paid-plan" predicates (`plan.id === "pro" || plan.id === "max"` or a shared `isPaidPlan(plan)` helper), and billing page's `isPro` must become `isPaid` (BillingManager signature change). Otherwise Max users silently lose pro-only functionality and the accept criteria regress.
- Engineering rationale: the existing `plan.features.*` boolean surface is the correct home for capability, but `plan.features.uptime/github/activeTests/onDeploy` is a different axis than the identity gates above (which conflate "is pro" with "has these features"). Recommendation: add a shared `isPaidPlan(id)` helper (e.g. in `packages/scan-core/src/credits.ts` or `packages/shared`) and switch the 8 identity sites to it; keep feature-flag gates as-is. No change to DB.
- Verification: grep predicates `plan\.id`, `=== "pro"`, `!== "pro"`, `isPro` across `apps/web/**/*.{ts,tsx}` (27 hits; 8 identity-gate sites above); full reads of threats routes/page, schedule route, billing page, billing-manager, pricing-cards. Phase-1 audit's "No max anywhere" claim (:81) re-confirmed.
- Remaining risk: if the implementer broadens only the `features.*` axis, the identity gates stay broken for max; the upsell `next-plan` mapping (free→pro; pro/max→none, since max seats=3 < pro maxMembers=10) is an open orchestrator decision.

## MFL-20260818-012 — `apps/web/.env.example` is gitignored; scope-verification method must treat it as disk-only
- Time: 2026-08-18
- Actor / role: implementer (phase-2-task-B-stripe-max-7c1d)
- Phase / task: phase-2 (plan-64 step 2 — Max billing wiring)
- Type: verification-method correction
- Status: recorded
- Related entries: MFL-20260818-010
- What: The task's verification step 5 ("git status --porcelain + hash-compare vs scope-baseline.json: only the 8 declared paths changed") cannot include `apps/web/.env.example`: it is matched by the `apps/web/.gitignore:34` pattern `.env*` (confirmed via `git check-ignore -v`; `git show HEAD:apps/web/.env.example` → "exists on disk, but not in 'HEAD'"; `git ls-files -s` → empty). The task facts list it among the 8 scope files, and the scope-baseline records a disk hash for it, but git status will never surface it.
- Why it matters: without this correction, the "only the 8 declared paths changed" check would be misreported as an anomaly (`.env.example` present-but-invisible) or, worse, the file's change could go unverified because it is invisible to git.
- Engineering rationale: `.env.example` is a doc-templating file that carries no secrets, but the repo ignores the whole `.env*` family to keep real env files untracked — `.env.example` is collateral of that pattern. Verification for it must use direct content checks (here: the two `STRIPE_PRICE_MAX(_ANNUAL)` lines present, matching the pro-annual comment style) and disk-hash deltas, not git.
- Verification: `git check-ignore -v apps/web/.env.example` → `apps/web/.gitignore:34:.env*`; `git ls-files -s apps/web/.env.example` empty; `rg STRIPE_PRICE_MAX apps/web/.env.example` → lines 78-79 present.
- Remaining risk: none. The 7 git-tracked scope files were confirmed via `git status --porcelain` delta (exactly those 7 new modifications vs the pre-existing baseline), and `.env.example` was content-verified.

## MFL-20260818-013 � Reviewer (round 1) verification of phase-2-task-B (Stripe max wiring): PASS
- Time: 2026-08-18
- Actor / role: reviewer (phase-2-task-B-stripe-max-7c1d), round 1
- Phase / task: phase-2, task-B (billing/Stripe max wiring)
- Type: verification note
- Status: recorded
- Related entries: MFL-20260818-010 (decisions), MFL-20260818-012 (.env.example gitignored), MFL-20260818-011 (task-A plans contract)
- What: independently re-derived, did not trust the implementer report:
  1. **Scope**: Compare-Object(git status --porcelain, changed-paths-inventory.txt) = exactly the 7 git-tracked task files (subscription/route.ts, 3 test files, illing-core.ts, illing.ts, env.ts); .env.example gitignored (pps/web/.gitignore:34) but disk-hash changed vs baseline and content-verified (lines 78-79 document STRIPE_PRICE_MAX(+_ANNUAL)). No packages/shared or packages/db files touched.
  2. **Code**: env.ts max vars mirror pro style (optional, min(1)); resolvePlanFromPrice adds max branch after pro (undefined env ? null, mirrors pro); createCheckoutSession price branches on planId==="max", pro else-branch byte-identical; switchSubscriptionInterval signature (id, interval, planId: PlanId), sole production caller subscription/route.ts:59 passes subscription.plan (typed PlanId from scan-core SubscriptionState); handleCheckoutCompleted uses planIdSchema.safeParse(metadata.plan_id) default "pro".
  3. **Fail-before (log evidence)**: production files reverted to HEAD ? 5 tests failed / 42 passed (billing-core max-checkout; billing-routes PATCH switch; billing.test resolvePlanFromPrice / checkout-max / switch-max); restore confirmed (current diff == implementation). Legacy-default, invalid-plan_id, checkout-POST-max are contract locks passing on old code by design � real new behavior is fail-before-covered.
  4. **Verification**: billing tests 47/47 (14+20+13) green; web + root (8-pkg) typecheck green; lint green. Caller greps across repo: no callers of the 3 changed functions outside apps/web; all accounted for.
  5. **Spec note (non-blocking)**: verification command 1's pps/web/lib/__tests__/� paths fail with "No test files found" because vitest is rooted at apps/web (include lib/**/*.test.ts); app-relative paths run the same 3 files green.
- Why it matters: closes the MFL-011 residual risk ("first real max checkout must land together with task B's price mapping") � task B now charges the Max price and the webhook writes plan "max" from checkout metadata, so a Max checkout can no longer be under/over-charged or land on "pro".
- Engineering rationale: none beyond recording the reviewer verdict and the residual downstream wiring (identity gates = task C, seat 409/upsell = task D, pricing UI = task E).
- Verification: review-1.md (all command outputs recorded there); run-implementer-1.log fail-before block.
- Remaining risk: none task-relevant. Identity gates (isPaidPlan) still block max users from pro features until task C; STRIPE_PRICE_MAX not yet set in real environments (env-driven, same as pro).

## MFL-20260818-014 — Orchestrator + worker profile changed to Claude(director)+Sonnet 5(workers)
- Time: 2026-08-18T (resume)
- Actor / role: main orchestrator (Claude Code)
- Type: decision (configuration)
- Status: fixed (recorded)
- What: User instruction "rondt dit en gebruik sonnet 5 en jij zelf als director". Effective config
  changed: orchestrator = Claude Code (Opus), workers (all roles) = Claude `Agent` tool subagents
  (general-purpose, model sonnet). Each Agent call is a fresh worker; reviewer repair via SendMessage.
  Run id keeps its `-opencode-` slug for path continuity only.
- Impact: no change to any accepted artifact. Phase-1 + phase-2 discovery/A/B evidence remain valid.
  Prior OpenCode worker PIDs (27588, 2992) confirmed dead at resume; no live worker inherited.
- Verification: state.json + effective-configuration.md updated; process liveness checked (both dead).

## MFL-20260818-015 — Phase-2 task-B (Stripe max wiring) ACCEPTED via fast path
- Time: 2026-08-18T (resume)
- Actor / role: main orchestrator (Claude Code)
- Phase / task: phase-2, task-B (phase-2-task-B-stripe-max-7c1d)
- Type: task acceptance
- Status: fixed (accepted)
- Related entries: MFL-20260818-013 (reviewer PASS), MFL-20260818-010 (decisions), MFL-20260818-008
- What: review-1.md reported `VERDICT: PASS`, FAST-PATH ELIGIBLE: YES — independent reviewer,
  all 6 acceptance criteria re-verified, billing tests 47/47, repo typecheck (8 pkgs) + lint green,
  scope = exactly the 8 declared files (7 git-tracked + gitignored .env.example content-verified),
  pro/free behavior + API contracts preserved. Fast-path conditions all met → accepted without
  orchestrator re-review, per skill economy contract.
- Remaining risk: none task-relevant. STRIPE_PRICE_MAX still unset in real envs (env-driven, same as pro);
  identity gates (isPaidPlan) still block max users from pro-only features until task C — by design/order.

## MFL-20260818-016 — Phase-2 task-C (isPaidPlan + 8 identity gates) ACCEPTED via fast path
- Time: 2026-08-18T (resume)
- Actor / role: main orchestrator (Claude Code)
- Phase / task: phase-2, task-C (phase-2-task-C-paid-gates); impl=Sonnet5 a594…, review=Sonnet5 a546…
- Type: task acceptance
- Status: fixed (accepted)
- Related: MFL-20260818-008 (the 8 gates), MFL-20260818-010 (decisions), MFL-20260818-014 (profile)
- What: fresh independent reviewer VERDICT: PASS, FAST-PATH ELIGIBLE: YES. Reviewer re-derived from
  source (git diff ground truth), disproved all 3 risk hypotheses (no inverted `!`; fail-before is a
  genuine behavioral 403→200 not a compile artifact; no scope creep — invites-core.ts & pricing-cards.tsx
  byte-identical). Scope = exactly 14 declared files via scope_snapshot.py compare + git cross-check.
  Independently re-ran all 6 verification commands: shared 571/571, web 588/588, typecheck+lint clean at
  filter and repo scope. Helper `isPaidPlan=(id)=>id!=="free"` in packages/shared/src/plans.ts; 7 call
  sites + BillingManager isPro→isPaid prop rename; upsell targets + feature-flag gates untouched.
  Fast-path conditions all met → accepted, no orchestrator re-review.
- Remaining risk: component/page-level (.tsx) gates have no jsdom/RTL test (repo has none; vitest node-only)
  — declared, consistent with existing infra; API-route gates (4/8) have behavioral TDD. Non-blocking.

## MFL-20260818-017 — Phase-2 task-D (invite 409+upsell + client modal) ACCEPTED via fast path
- Time: 2026-08-18T (resume)
- Actor / role: main orchestrator (Claude Code)
- Phase / task: phase-2, task-D (phase-2-task-D-invite-seat); impl=Sonnet5 ac90…, review=Sonnet5 afaa…
- Type: task acceptance
- Status: fixed (accepted)
- Related: MFL-20260818-010 (decisions), MFL-20260818-001 (seat limit exists), OSD-002 (sites-manager quirk)
- What: fresh independent reviewer VERDICT: PASS, FAST-PATH ELIGIBLE: YES. Verified from git-diff
  ground truth: invites-core limit source = features.seats ?? maxMembers; nextPlanForMemberLimit
  (free→pro, pro/max→null); POST invitations route member_limit 400→409 +conditional upsell; accept
  route →409 no-upsell; hardcoded "Upgrade naar Pro" message dropped; team-settings.tsx modal reads REAL
  payload shape data.upsell.plan (does NOT reproduce sites-manager bug) and POSTs {planId} to checkout.
  Route tests hit real handlers (not mock artifacts); message assertion strengthened not weakened.
  Content-hash compare: exactly 5 declared files + tests changed (state.json diff = orchestrator's own
  edit, excluded); pricing-cards.tsx / task-C gates / plans.ts byte-identical. web 600/600, typecheck
  8/8, lint clean. Fast-path → accepted.
- Known limitation (accepted, disclosed): features.seats ?? maxMembers not test-discriminable for max
  (plans.max maxMembers===seats===3, MFL-010 dec5). Code correct; data coincidence, not a defect.

## MFL-20260818-018 — Phase-2 task-E (3-tier pricing/billing UI) ACCEPTED via fast path
- Time: 2026-08-18T (resume)
- Actor / role: main orchestrator (Claude Code)
- Phase / task: phase-2, task-E (phase-2-task-E-pricing-ui); impl=Sonnet5 afbe…, review=Sonnet5 a305…
- Type: task acceptance
- Status: fixed (accepted)
- Related: MFL-20260818-010 (decisions)
- What: fresh independent reviewer VERDICT: PASS, FAST-PATH ELIGIBLE: YES. pricing-cards.tsx → 3 cols,
  genericized highlight/CTA/busy-label (max featured; pro loses highlight per spec-offered option),
  seats/white_label rows (free/pro members row byte-identical), no pro→max upsell affordance,
  checkout POST body unchanged. billing/page.tsx: only the isPaid COPY ternary (:66-70) changed; isPaid
  computation (:35) + BillingManager props (:92-96) are task-C's post-state, byte-identical. New
  plans-route.test.ts hits real /api/plans, asserts 3 plans + max features. web 601/601, typecheck 8/8,
  lint clean. Endorsed the implementer's UX call (replace max member-count row with seats row, data-
  conditioned). Fast-path → accepted.
- Structural note: repo works on UNCOMMITTED main, so `git diff HEAD` bundles all task changes; per-task
  scope is proven via content-hash scope-baseline.json per task (advisor-recommended). Continue this;
  do NOT commit (baseline mixes other plans' uncommitted work; no user authorization to commit).

## MFL-20260818-019 — PHASE 2 APPROVED (orchestrator hard gate)
- Time: 2026-08-18T (resume)
- Actor / role: main orchestrator (Claude Code)
- Phase: phase-2 (plan-64 step 2 — max plan billing wiring + invite 409+upsell)
- Type: phase approval
- Status: fixed (approved)
- Related: MFL-011/013/015/016/017/018 (task acceptances A-E), phase-audit.md
- What: fresh independent Phase Auditor AUDIT: READY, FAST-PATH synthesis. All 5 integration chains
  traced through LIVE source (not diffs): (1) max checkout→webhook writes plan='max' in SQL upsert→
  isPaidPlan opens all 8 ex-"pro" gates (zero stray plan.id==="pro" gates left except 1 harmless display
  label); (2) invite free-at-limit→409+upsell{plan:"pro"}→real checkout; pro/max→409 no upsell
  (getPlanForTeam resolves actual plan); (3) max seat=3 via features.seats, free/pro 3/10 unchanged,
  downgrade never deletes memberships (webhook touches only subscriptions; removeMember is owner-action);
  (4) 3 tiers everywhere, exhaustive upsell grep = every target "pro" never "max"; (5) all 5 tasks'
  changes coexist in the live files. Full suite re-run: pnpm typecheck 8/8, lint clean, shared 571, web 601.
- Orchestrator judgment: plan-64 step-2 acceptance criteria met (Max 3 seats; invite→409+upsell;
  downgrade preserves members). Phase-2 APPROVED. Proceed to phase-3 (white-label branding).
- Non-blocking carried forward: OSD-001, OSD-002; migration 026 live-apply re-verify; STRIPE_PRICE_MAX
  env unset until deploy; features.seats??maxMembers not test-discriminable for max.
