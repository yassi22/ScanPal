# Phase Audit — phase-1 · plan 64 Team seats + client-workspaces + white-label

Phase: phase-1 · Role: Phase Auditor · Task: `phase-1-audit-2d91` (phase-1 hard gate) · Run: `20260818T110500Z-opencode-7f2d`
This report is advisory for the main-orchestrator hard gate. It is read-only: **no project file was modified by this audit.**

## Decision Packet

- **Role / task id**: PHASE AUDITOR · `phase-1-audit-2d91`
- **Status / verdict**: READY — all phase-1 requirements verified against durable task + reviewer evidence; **0 blocking findings**; 2 non-blocking open items (see Unresolved risks).
- **Read-only scope**: no project file modified; only this report + one major-log entry (MFL-20260818-008) appended.
- **Criteria summary**: plan-64 step 1 delivered in two PASS-reviewed units — migration `026` (DB contract) + `packages/shared` contracts (`brandingSchema`, `workspaceSchema`, `reportTokenSchema` + token helpers). Every phase requirement is met; DB↔shared alignment is consistent (matrix below).
- **Verification summary**: reviewer-recorded shared suite **38 files / 557 tests** (incl. new `report-tokens.test.ts`, 16 tests), root typecheck (8 pkgs) Done, lint exit 0 — confirmed present in `run-*.log`. This audit re-ran only cheap classes: SHA-256 scope compares (byte-identical), consumer greps, run-log authenticity spot-checks, constraint-name verification against `003_billing.sql`. Full test/typecheck/lint classes were NOT rerun (rule 5); evidence already complete.
- **Scope / preservation result**: CLEAN. All 25 pre-existing migrations + `migrate.ts` byte-identical to `scope-baseline.json` (re-derived by this audit). `packages/db/src/index.ts` and `packages/shared/src/index.ts` are the only baseline files that changed (both declared targets, additive). `plans.ts`, `public-status.ts`, `report.ts` byte-identical. No existing test modified. Plan file `docs/plans/64-team-seats-white-label.md` unmodified. Only new paths = declared: `026_team_seats_white_label.sql` + 4 shared files.
- **Major-log ids**: MFL-20260818-001..007 (prior) + MFL-20260818-009 (this audit: forward-compat schema gaps + cosmetic note; renumbered from -008 on a concurrent append collision).
- **Unresolved risks / blockers**: (1) Migration 026 validated statically only — Docker daemon off, `psql` absent; first real `pnpm db:migrate` should re-verify (non-blocking, task-allowed). (2) JSDoc in `report-tokens.ts` says "16 bytes entropie" while the v4-UUID-derived generator yields 122 bits — cosmetic, non-blocking. (3) Phase-2 ordering: `packages/shared` must gain `'max'` before any `'max'` subscription row can exist (MFL-005).
- **Exact evidence paths**: this file · `current-state-audit.md` · `phase-1-task-1-migration-026-4f7b/{implementer-report,review-1,task.md,scope-baseline.json,changed-paths-inventory.txt,run-reviewer-1.log}` · `phase-1-task-2-shared-schemas-9c2e/{implementer-report,review-1,task.md,review-task-1.md,scope-baseline.json,changed-paths-inventory.txt,run-implementer-2.log,run-reviewer-1.log}` · `packages/db/migrations/026_team_seats_white_label.sql` · `packages/db/src/index.ts` · `packages/shared/src/{branding,workspaces,report-tokens,index,plans,public-status}.ts` + `__tests__/report-tokens.test.ts` · `packages/db/migrations/003_billing.sql` · `major-findings-and-fixes.md` · `docs/plans/64-team-seats-white-label.md`
- **FAST-PATH ELIGIBLE**: **YES** — complete independent evidence across both units, zero blocking findings, scope/preservation hash-verified, no contradiction requiring orchestrator investigation.

---

## 1. Phase-requirement coverage (plan 64 step 1)

| # | Requirement | Evidence | Verdict |
|---|---|---|---|
| 1 | Migration `026` exists, valid, convention-consistent | `026_team_seats_white_label.sql` present; reviewer statement-by-statement matrix vs 001/003/006/012/019/025; header/rollback style matches 025. | PASS |
| 2 | `teams.branding jsonb not null default '{}'` | 026:8, cast style `'{}'::jsonb` mirrors 001:49/025:7. | PASS |
| 3 | `workspaces(id uuid pk, parent_team_id uuid not null FK teams cascade, name text not null, created_at timestamptz default now())` + parent index | 026:10-17. | PASS |
| 4 | `sites.workspace_id uuid null` FK `on delete set null` + index | 026:19-20. | PASS |
| 5 | Per-scan report token + optional expiry + partial unique index (`scans.report_token`, `scans.report_token_expires_at`, `scans_report_token_key` where not null) | 026:28-32; partial-unique pattern mirrors 019:8-11. | PASS |
| 6 | 32-hex tokens (MFL-003 decision 2) | `REPORT_TOKEN_PATTERN = /^[0-9a-f]{32}$/`, `generateReportToken()` returns exactly that (test-proven, 1000-call uniqueness; reviewer direct Node probe). | PASS |
| 7 | `brandingSchema`, `workspaceSchema`, `reportTokenSchema` + token helpers | `packages/shared/src/{branding,workspaces,report-tokens}.ts`, re-exported from `index.ts:149-151`; helpers `generateReportToken`/`isValidReportToken` + constants. | PASS |
| 8 | `planIds` includes `'max'` in `packages/db/src/index.ts`; `subscriptions.plan` check admits `'max'` | `index.ts:6`; 026:35-37. `packages/shared/src/plans.ts:3` intentionally still `['free','pro']` — phase 2 (confirmed, see §5). | PASS |

Sub-requirements beyond the phase text but part of MFL-003 decisions 1/3 (seats + workspace roles): `subscriptions.plan` check replaced to `('free','pro','max')` (026:35-37, verified drop/re-add target exists at `003_billing.sql:8` inline unnamed check → Postgres auto-name `subscriptions_plan_check`) and `memberships.workspace_id` + index (026:22-23). Both consistent with the orchestrator decisions recorded in MFL-003.

## 2. DB-schema ↔ shared-schema alignment (independent matrix)

| DB (026 + `packages/db/src/index.ts`) | Shared (`packages/shared`) | Consistent? |
|---|---|---|
| `teams.branding jsonb not null default '{}'` | `brandingSchema` — all fields nullable/optional; `{}` parses; `hide_branding` `.default(false)` | YES — DB default is a valid schema input; JSONB stores the shape the schema validates |
| `workspaces(id uuid, parent_team_id uuid, name text not null, created_at timestamptz)` | `workspaceSchema` row = `{id uuid, parent_team_id uuid, name trim min1 max80, created_at datetime}` | YES — field names identical; uuid↔`string().uuid()`, timestamptz↔`string().datetime()`; schema stricter on `name` (input/row validation) — intended |
| `sites.workspace_id` / `memberships.workspace_id` | no shared row schema mirrors these yet (`siteSchema` is a minimal shape, not a full-row mirror) | YES for this phase — consumers land in phase 4; forward-compat note in §5 |
| `scans.report_token text` + `scans.report_token_expires_at timestamptz` | `reportTokenSchema = { token (32-hex regex), expires_at (datetime, nullable, optional) }` | YES — `token`↔`report_token` (share-payload naming), `expires_at`↔`report_token_expires_at`; 1:1 semantics |
| `planIds = ["free","pro","max"]` (db index.ts:6) | `planIdSchema = ['free','pro']` (plans.ts:3) | EXPECTED gap — intentionally phase 2 (explicitly confirmed, §5) |

No contradictions found. The `token`/`report_token` field-name difference is the response-payload naming the orchestrator's own decision specified; the partial-unique-index name `scans_report_token_key` follows the `_key` convention.

## 3. Cross-task wiring / architecture / compatibility

- **Task-1 → Task-2 wiring**: migration column names ↔ shared field names align exactly (§2). Type-level contract (`*Row` types) matches the schema shapes (`WorkspaceRow`↔`workspaceSchema`, `ScanRow.report_token*`↔`reportTokenSchema`, `TeamRow.branding`↔`brandingSchema`).
- **Zero consumers by design**: grep across `apps/web`, `apps/worker`, `apps/scheduler`, `packages/mcp-server`, `packages/notify`, `packages/scan-core` for `workspace_id|report_token|reportToken|branding` (non-test source) → **0 hits**. Phases 2–5 consume; typecheck across 8 packages green proves no type-level breakage from the widened `*Row` types / `planIds`.
- **Architecture/conventions**: migration reuses established index naming, defaults, constraint drop/re-add pattern, partial-unique-index shape, bottom rollback block. Shared package stays zod-only; one file per contract area; plain `z.object` + `z.infer` types; Dutch JSDoc. Token helper reuses the canonical `generatePublicStatusSlug` technique (verified: `public-status.ts:51-56` uses global `crypto.randomUUID().replace(/-/g,"")`; `globals.d.ts` types global `crypto` as `{ randomUUID(): string }` only — so `randomBytes`/`getRandomValues` are NOT type-available; the deviation in MFL-006 is fully justified and accepted by review).
- **Accepted-behavior preservation**: 25 migrations + `migrate.ts` byte-identical (re-derived, §4); no existing row type lost a field; `planIds` shape preserved; `plans.ts`/`public-status.ts`/`report.ts` byte-identical; no existing test modified; plan check constraint is a widening (`('free','pro')`→`('free','pro','max')`), non-breaking for existing rows; DB default `'{}'` for branding is transparent to all existing reads of `teams.*` (new column only).

## 4. Scope / preservation (this audit's independent re-derivation)

Predicate: every file in each task's `scope-baseline.json` must be SHA-256-identical now, except the declared targets; the only new files must be the declared ones.

- **Task-1 scope** (all `packages/db/migrations/*` + `src/*`): 27/28 baseline entries `OK`; the single `DIFF` is `packages/db/src/index.ts` (declared target). New file: `026_team_seats_white_label.sql` only. Matches `git status --porcelain` delta vs `changed-paths-inventory.txt` (exactly one new entry).
- **Task-2 scope** (`packages/shared/src`): 1 `DIFF` (`src/index.ts`, declared target; reviewer reconstructed baseline hash `F9ED65B6…` byte-for-byte by removing the 3 new export lines); 4 new files exactly `branding.ts`, `workspaces.ts`, `report-tokens.ts`, `__tests__/report-tokens.test.ts`. `plans.ts`/`public-status.ts`/`report.ts` byte-identical (also confirmed in this audit via the full-file compare: no DIFF, no MISSING).
- Plan file `docs/plans/64-team-seats-white-label.md`: tracked, absent from `git status` → unmodified.
- Evidence authenticity: shared-suite output (`38 passed` / `557 passed`) and root typecheck (`8 packages` all `Done`) reproduced in the actual `run-implementer-2.log` and `run-reviewer-1.log` files — claims are real, not fabricated.

## 5. User/domain impact and forward-compat ordering constraints (non-blocking)

No runtime impact today (no consumers). The durable constraints for phases 2–5:

1. **Phase 2 (billing/seats)** — MUST extend `packages/shared/src/plans.ts` (`planIdSchema`, `plans` record, `planList`, `publicPlanSchema`, `subscriptionSchema`) and add `seats`/`white_label` features **before** any code writes a `'max'` row. Verified hazard sites if it does not: `packages/scan-core/src/credits.ts:43,83` (`plans[planId].creditsPerPeriod`), `apps/scheduler/src/credits.ts:48`, `apps/web/lib/invites-core.ts:71` (`plans[planId].maxMembers`) — all index into a record that only knows `free`/`pro` today. This audit confirmed **no** code path writes `'max'` today (grep over source: the only `'max'` plan reference in non-test source is `packages/db/src/index.ts:6`). Also extend `inviteInputSchema`/`invite route` for the seat 409 + upsell shape per MFL-001.
2. **Phase 3 (branding consumers)** — `teamSchema` (shared index.ts:22) does not carry `branding`; extend it or compose `brandingSchema` when reading `teams.branding`; PDF/MD renderer then consumes it.
3. **Phase 4 (workspaces)** — `membershipSchema` (index.ts:29) and `teamMemberSchema` (index.ts:91) do not carry `workspace_id`; extend them for member-scoping. `siteSchema` (sites.ts:90) is a minimal shape, not a full-row mirror, so `sites.workspace_id` needs no immediate shared change, but workspace-scoped site queries will read the column.
4. **Phase 5 (portal)** — `scans.report_token`/`report_token_expires_at`, `reportTokenSchema`, and `generateReportToken`/`isValidReportToken` are ready; route assembly, noindex + rate limit per plan lines 26/34.

## 6. Defect / risk register

- **Open (non-blocking): live-PG apply of 026 never executed.** Docker daemon off (`docker version` → connection error), `psql` not installed, no offline PG parser in node_modules. Static + typecheck verification was substituted per task allowance (task.md criterion 1). Residual apply-time risk is low (statements are direct mirrors of applied precedent, incl. constraint name verified against `003_billing.sql:8`) but non-zero. **Recommended**: verify with the next real `pnpm db:migrate` (throwaway DB) before phase-2 runtime code depends on the columns.
- **Open (cosmetic):** `report-tokens.ts:5,10` JSDoc states "16 bytes entropie"; the v4-UUID-derived generator actually provides 122 bits (~15.25 bytes). No functional impact (format contract is 32 lowercase hex; 122 bits ≫ 64-bit brute-force threshold). Optional future one-line comment correction; not a defect.
- **No blocking findings. No test integrity issues.** New tests assert both accept-valid and reject-invalid directions against an independent constant (`VALID_TOKEN`), not tautologically against the generator (reviewer audited this explicitly).

## 7. Missing / contradictory evidence

- No contradiction found between orchestrator claims, implementer reports, reviewer verdicts, run logs, and this audit's re-derivation (hashes, greps, file reads).
- The only verification class absent anywhere is the live-PG migration apply (see §6) — explicitly permitted and honestly disclosed in both task reports and MFL-004.
- Task PASS markers were treated as leads and independently checked: reviewer reports contain real command output (test counts, typecheck "Done" lines, hashes, porcelain diffs, direct Node probes), and this audit confirmed the same facts from the actual files and logs.

## 8. Major log

Existing entries MFL-20260818-001..007 cover: seat-limit claim correction (001), report-content route move (002), orchestrator decisions (003), static-verification + baseline preservation (004), the shared-`'max'` ordering gap (005), token-entropy decision (006), and reviewer re-verification (007). This audit appends MFL-20260818-009 (forward-compat schema gaps `teamSchema`/`membershipSchema` + cosmetic entropy-comment note). Note: a concurrent phase-2 discovery worker appended its own entry claiming `MFL-20260818-008` (Paid-plan identity gates) after this audit's entry was written; this audit's entry was renumbered to `-009` to keep IDs unique — the orchestrator should reconcile the `MFL-20260818-008` ID collision between the two entries.

---

## Audit verdict

All phase-1 requirements are met and verified against durable evidence. DB↔shared alignment is consistent; scope/preservation is hash-clean; no blocking findings; the two open items (live-PG apply test, cosmetic JSDoc) are non-blocking and remediation-ready.

**AUDIT: READY**
