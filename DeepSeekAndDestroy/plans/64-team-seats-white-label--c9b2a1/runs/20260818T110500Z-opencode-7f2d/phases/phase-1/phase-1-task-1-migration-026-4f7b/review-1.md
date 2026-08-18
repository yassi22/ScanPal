# Review 1 — phase-1-task-1-migration-026-4f7b

## Decision Packet

- **Role / Task**: REVIEWER — phase-1-task-1-migration-026-4f7b
- **Status / Verdict**: PASS
- **Changed paths (implementation under review)**: `packages/db/migrations/026_team_seats_white_label.sql` (new),
  `packages/db/src/index.ts` (extended additively). Review was read-only.
- **Criteria summary**: (1) 026 exists, PostgreSQL-valid, follows 001/003/006/012/019/025 conventions — PASS;
  (2) exactly the prescribed schema changes, correct FKs/defaults/partial-unique index, 'free'/'pro' preserved — PASS;
  (3) index.ts additive type/const additions, matching style, no field removed — PASS;
  (4) `pnpm typecheck` + `pnpm lint` pass, no tests modified, nothing outside packages/db touched — PASS;
  (5) scope preserved (byte-identical to scope-baseline.json except the declared target + new 026).
- **Verification summary**: typecheck (8 pkgs) exit 0; lint (web eslint) exit 0; SHA-256 compare vs
  scope-baseline.json → only `src/index.ts` changed, 0 missing, 026 the only new file under packages/db;
  `git status --porcelain` diff vs changed-paths-inventory.txt → exactly one new entry (`026` migration).
- **Scope/preservation result**: CLEAN. All 25 pre-existing migrations + migrate.ts byte-identical to baseline.
  Baseline plan-62 `crux` edit in index.ts preserved untouched.
- **Major-log ids**: MFL-20260818-005 (forward-compat contract gap: `packages/shared` planIdSchema still
  `['free','pro']`; not a task defect — later-phase wiring).
- **Unresolved risks/blockers**: Docker daemon off, `psql` absent → no live-PG apply test; static SQL review
  substituted (permitted by task). Residual apply-time risk low but non-zero; first real `pnpm db:migrate`
  should re-verify.
- **Evidence paths**: `scope-baseline.json`, `changed-paths-inventory.txt`, `implementer-report.md`,
  `packages/db/migrations/026_team_seats_white_label.sql`, `packages/db/src/index.ts`,
  `packages/db/src/migrate.ts`, migrations 001/003/006/009/011/012/019/024/025, `task.md` (map §145-172).
- **FAST-PATH ELIGIBLE**: YES — independent review, all required verification complete with recorded output,
  scope/preservation evidence clean, no conflict requiring orchestrator investigation.

---

# VERDICT: PASS

## 1. Acceptance criteria — evidence

### Criterion 1 — migration exists, valid, convention-consistent — PASS
File exists (2460 bytes, UTF-8 no BOM, trailing newline — byte-identical header style to 025: first bytes
`2D 2D 20 30` = "-- 0"). Statement-by-statement static review against the repo's applied-style conventions:

| 026 statement | Convention source | Match |
|---|---|---|
| `alter table teams add column branding jsonb not null default '{}'::jsonb;` | 001:49 `findings jsonb not null default '{}'::jsonb`, 025:7 `crux jsonb not null default '{}'::jsonb` | exact |
| `create table workspaces (id uuid pk default gen_random_uuid(), parent_team_id uuid not null references teams(id) on delete cascade, name text not null, created_at timestamptz not null default now())` | 001:17-21 teams, 001:24 memberships FK cascade, 001:37 sites FK cascade | exact |
| `create index workspaces_parent_team_id_idx on workspaces(parent_team_id);` | 001:33 `memberships_user_id_idx` | naming exact |
| `sites.workspace_id uuid references workspaces(id) on delete set null` + `sites_workspace_id_idx` | 006:6 FK set null + index style | exact |
| `memberships.workspace_id … on delete set null` + `memberships_workspace_id_idx` | 006:6 | exact |
| `scans.report_token text` + `report_token_expires_at timestamptz` + `create unique index scans_report_token_key on scans (report_token) where report_token is not null;` | 019:8-11 `sites_public_status_slug_key` | statement-identical |
| `drop constraint subscriptions_plan_check` + `add constraint … check (plan in ('free','pro','max'))` | 011:64-68 / 012:17-22 drop+add pairs; 011:63 comment "constraint-namen zijn de Postgres-defaults" | exact |
| Rollback comment block at bottom, `-- Rollback (geen down-migraties in deze repo; ter referentie):`, reverse-ordered | 006:12-18, 012, 019:13-15, 025:9 | exact |

No stubs, TODOs, placeholders, or hard-coded temp values in the migration.

### Criterion 2 — exactly the prescribed schema changes — PASS
Cross-checked 026 against the task's construction map (task.md §145-163) and the TASK OBJECTIVE. Every
element present with the correct type/FK/on-delete/default: `teams.branding jsonb not null default '{}'`;
`workspaces(id uuid pk default gen_random_uuid(), parent_team_id uuid not null FK teams on delete cascade,
name text not null, created_at timestamptz not null default now())` + parent index; `sites.workspace_id` and
`memberships.workspace_id` FK `workspaces on delete set null` + indexes; `scans.report_token text` +
`scans.report_token_expires_at timestamptz` + partial unique index `scans_report_token_key` (where not null);
subscriptions plan check now `('free','pro','max')` — 'free'/'pro' preserved. Nothing extra (no other
tables/columns/indexes). Partial-unique-index syntax mirrors 019 exactly (name-first, `on tbl (col)`,
`where col is not null`).

### Criterion 3 — index.ts additive type/const additions — PASS
Verified the full file and `git diff`: plan array `["free","pro","max"]` (line 6, shape kept); `TeamRow.branding:
Record<string, unknown>` (line 55, typed like the existing `crux`/`diff` JSONB fields); new exported `WorkspaceRow`
(lines 59-64, `export type` pattern matching file style, placed after TeamRow); `MembershipRow.workspace_id:
string | null` (69); `SiteRow.workspace_id: string | null` (79); `ScanRow.report_token: string | null` (130) and
`report_token_expires_at: Date | null` (131). Diff is strictly additive — no field removed, no unrelated row
touched. Baseline plan-62 `crux` field on ScanRow preserved unchanged.

### Criterion 4 — typecheck + lint green — PASS (real output recorded)
- `pnpm typecheck` (root → `pnpm -r typecheck`, 8 packages): `packages/db … apps/worker typecheck: Done` — exit 0, no diagnostics. (Includes db package's own `tsc --noEmit`.)
- `pnpm lint` (root → `pnpm --filter web lint` → eslint): exit 0, no diagnostics.

### Criterion 5 — no tests modified; nothing outside packages/db — PASS
`git status --porcelain` current vs `changed-paths-inventory.txt`: the ONLY entry not present in the pre-task
baseline inventory is `?? packages/db/migrations/026_team_seats_white_label.sql`. Zero inventory entries missing.
All modified test files (findings-patch-route.test.ts, report-content-route.test.ts, registry.test.ts,
aggregate.test.ts, dispatcher.test.ts, mcp.test.ts) are baseline entries, unchanged by this task.

### Scope / preservation — PASS (content-hash comparison, real output)
Predicate: every file in `scope-baseline.json` (25 migrations + `src/migrate.ts` + `src/index.ts`) must be
SHA-256-identical except the declared target `src/index.ts`; and the only new file under packages/db is 026.
Result of the independent re-run:
```
=== CHANGED (vs baseline) ===
packages\db\src\index.ts  BASELINE=18C91A4C... NOW=55C4922E...
=== MISSING ===
NONE
=== NEW files under packages/db (not in baseline) ===
packages\db\migrations\026_team_seats_white_label.sql
```
Plan file `docs/plans/64-team-seats-white-label.md` is tracked and unmodified (git ls-files confirms tracked;
absent from `git status`).

## 2. Risk hypotheses — resolution

1. **Check-constraint name / idempotency** — RESOLVED. 003:8 defines the plan check as an inline unnamed
   column constraint on `plan`, so PostgreSQL's deterministic auto-name is `subscriptions_plan_check` (011:63
   explicitly documents this auto-naming convention: "constraint-namen zijn de Postgres-defaults van migratie
   009"). 026's drop+re-add preserves that name and follows the exact 011/012 pattern. The runner
   (`src/migrate.ts`) applies each file exactly once inside a transaction (tracked in `schema_migrations`), so
   single-run drop/add is correct — same non-idempotent-at-file-level stance as 019/025 (`create index` without
   `if not exists`). No other migration references `subscriptions_plan_check` (grep over packages/apps: no
   collision).
2. **Partial unique index syntax/order** — RESOLVED. Statement-by-statement identical to 019:8-11.
3. **Consumer impact of `planIds` + row-type widening** — RESOLVED (no breakage, no reachable "max").
   - `planIds` is referenced only by `SubscriptionRow.plan` inside index.ts (grep: 2 hits, both in index.ts).
   - The changed row types (TeamRow/WorkspaceRow/MembershipRow/SiteRow/ScanRow/SubscriptionRow) are NOT
     imported anywhere in apps/packages. The only `@scanpal/db` imports in the repo are `ApiKeyRow`,
     `ThreatHoneypotRow`, `ThreatRuleRow`, `WebhookRow`, `WebhookDeliveryRow` (api-keys-core.ts:9,
     threats-core.ts:5, threat-rules.ts:4, webhooks-core.ts:11) — none affected. apps/worker + apps/web define
     local row types (scan-worker.ts:23, crawl.ts:21, poller.ts:7, authz.ts:6, sites-core.ts:10,
     public-status-core.ts:18) and do NOT consume the db types.
   - Runtime reachability of `'max'`: no code path writes `'max'` to `subscriptions.plan` today
     (ensureSubscriptionRow writes 'free'; Stripe sync maps only free/pro prices). The `plans['max']`-undefined
     index hazard in `scan-core/src/credits.ts:43/83` and `apps/web/lib/invites-core.ts:71` is therefore
     unreachable until a later phase wires billing — consistent with the task's phased-delivery contract
     (task.md: "packages/shared zod schemas are a separate task"). Forward-compat note logged (see §4).

## 3. Audit checklist

- SHORTCUTS: none. Full implementation, no stubs/TODOs/hard-coded values/partial wiring.
- BEHAVIORAL REACHABILITY: schema-only task; every column/constraint/index named by the contract verified to
  exist in 026 (see Criterion 2 matrix). Constraint replacement reachable only via migrate.ts's single-run
  transaction.
- NAMED AUTHORITIES: 001/003/006/009/011/012/019/024/025, `subscriptions_plan_check`, `sites_public_status_slug_key`,
  `gen_random_uuid`, planIds at index.ts:6 — all verified present.
- TEST INTEGRITY: no test modified (git status comparison, Criterion 5).
- ACCEPTED ARTIFACT COMPATIBILITY: no existing migration changed; no row type lost a field; plan array shape
  preserved.
- IMPACT: traced all `@scanpal/db` importers and row-type usage; zero affected consumers (see risk 3).
- REUSE: 026 reinvents nothing — reuses established index naming, defaults, constraint-drop pattern, rollback
  style, partial-unique-index shape.
- ARCHITECTURE/CONVENTIONS: additive, style-consistent, smallest-owner-dir (packages/db) per repo rule.
- VERIFICATION COVERAGE: typecheck + lint are the correct classes for a data-layer change; static SQL review
  is thorough and mirrors applied precedent (replaces unavailable container validation).
- SCOPE: content hashes + porcelain diff both clean.

## 4. Defect ledger (pre-existing / forward-compat, NOT task failures)

- **Forward-compat contract gap (informational)**: `packages/shared/src/plans.ts:3` `planIdSchema =
  z.enum(["free","pro"])` and the `plans` record have no `'max'` entry, while the DB (post-026) and
  `packages/db/src/index.ts` now admit `'max'`. Not a defect of this task (shared schemas are a separate task;
  'max' is unreachable at runtime until billing wiring lands). Later phases MUST add `'max'` to `planIdSchema`,
  the `plans` record, `planList`, `publicPlanSchema`/`subscriptionSchema`, and the invite-route upsell path
  (`apps/web/lib/invites-core.ts:71` reads `plans[planId].maxMembers`) before any `'max'` row can exist —
  otherwise `plans['max']` indexes to `undefined` and crashes at runtime. Logged as MFL-20260818-005.
- **`workspaces` has no RLS policy**: consistent with the no-RLS sites/scans precedent (024 enables RLS only on
  users/teams/memberships/subscriptions/api_keys); a design decision for the workspace endpoints phase, not a
  defect in this data-layer task.
- **Docker unavailable**: `docker version` → daemon not running ("failed to connect … dockerDesktopLinuxEngine"),
  `psql` not installed. Task permits static + typecheck verification in this case; recorded. Residual risk: a
  typo-level SQL defect could surface only at apply time; mitigated by statement-level mirroring of applied
  precedent. The first real `pnpm db:migrate` on a throwaway DB should confirm.

## 5. Conclusion

All 5 acceptance criteria met with real recorded verification output. The implementation is exactly the
prescribed construction map, additive and convention-consistent, scope clean, zero unresolved
task-relevant findings. PASS.
