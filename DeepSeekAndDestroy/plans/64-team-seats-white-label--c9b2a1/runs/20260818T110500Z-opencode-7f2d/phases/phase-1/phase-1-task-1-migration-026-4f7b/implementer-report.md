# Implementer Report — phase-1-task-1-migration-026-4f7b

## Decision Packet

- Role / task id: IMPLEMENTER · `phase-1-task-1-migration-026-4f7b`
- Status / verdict: COMPLETE — all 5 acceptance criteria PASS
- Changed paths: `packages/db/migrations/026_team_seats_white_label.sql` (new),
  `packages/db/src/index.ts` (extended). Nothing else touched.
- Criteria summary: migration 026 written per prescribed map; typecheck (root + db
  package) and lint pass; baseline migration hashes unchanged; no tests modified;
  no code outside packages/db touched.
- Verification summary: `pnpm typecheck` (root, 8 packages) PASS; `pnpm --filter db
  typecheck` PASS; `pnpm lint` (web eslint) PASS; scope-baseline hash re-check PASS
  (only `src/index.ts` changed among baseline files, plus new 026 migration);
  Docker unavailable → container SQL validation NOT run (daemon off), static
  verification substituted per task allowance.
- Scope/preservation result: all 25 existing migrations + `migrate.ts` byte-identical
  to scope-baseline.json; existing row types only gained fields; `planIds` shape kept
  with `"max"` appended; `'free'`/`'pro'` remain in the plan check constraint.
- Major-log ids: `ml-20260818-1` (Docker-unavailable → static verification; note on
  preserving pre-existing baseline edit in `src/index.ts`).
- Unresolved risks/blockers: none blocking. Runtime SQL application against a real
  Postgres not executed (per task exclusion); only a throwaway container would have
  been acceptable and Docker is off. Residual risk: a typo-level SQL defect could
  surface only at apply time; mitigated by statement-level static review mirrored
  against 001/003/006/012/019/025 conventions.
- Exact evidence paths:
  - This report
  - `scope-baseline.json` (baseline hashes, pre-change)
  - `changed-paths-inventory.txt` (baseline worktree state)
  - `packages/db/migrations/026_team_seats_white_label.sql`
  - `packages/db/src/index.ts`
- FAST-PATH ELIGIBLE: YES — single self-contained data-layer unit, all verification green,
  no runtime consumers touched.

## Implemented

### Migration `packages/db/migrations/026_team_seats_white_label.sql` (new)

Per the prescribed construction map, statement-by-statement:

1. `alter table teams add column branding jsonb not null default '{}'::jsonb;`
   (jsonb default quoted as `'{}'::jsonb` — exact style of `001:49` and `025:7`).
2. `workspaces` table: `id uuid primary key default gen_random_uuid()`,
   `parent_team_id uuid not null references teams(id) on delete cascade`,
   `name text not null`, `created_at timestamptz not null default now()` —
   column types/defaults mirror `001:17-21` (teams) and `003:23` (`gen_random_uuid()`).
3. `create index workspaces_parent_team_id_idx on workspaces(parent_team_id);`
4. `alter table sites add column workspace_id uuid references workspaces(id) on delete set null;`
   + `create index sites_workspace_id_idx on sites(workspace_id);`
5. `alter table memberships add column workspace_id uuid references workspaces(id) on delete set null;`
   + `create index memberships_workspace_id_idx on memberships(workspace_id);`
6. `alter table scans add column report_token text;`
   `alter table scans add column report_token_expires_at timestamptz;`
   `create unique index scans_report_token_key on scans (report_token) where report_token is not null;`
   — partial unique index mirrors `019:8-11` exactly.
7. `alter table subscriptions drop constraint subscriptions_plan_check;`
   `alter table subscriptions add constraint subscriptions_plan_check check (plan in ('free', 'pro', 'max'));`
   — `003:8` defines the plan check as an inline unnamed constraint, so PostgreSQL
   auto-names it `subscriptions_plan_check`; drop + re-add preserves the name and the
   `('free','pro')` values, appending `'max'`. Style matches `012`'s
   `drop constraint`/`add constraint` pairs.

Rollback block at the **bottom** of the file (dominant convention: 006, 012, 019, 025),
headed `-- Rollback (geen down-migraties in deze repo; ter referentie):`.

### `packages/db/src/index.ts` (extended)

- `planIds = ["free", "pro", "max"]` (shape kept, value appended; `'free'`/`'pro'` retained).
- `TeamRow` gained `branding: Record<string, unknown>` (typed like the existing `crux`/`diff`
  JSONB fields on `ScanRow`).
- New `WorkspaceRow` type (`id`, `parent_team_id`, `name`, `created_at`), exported via the
  file's standard `export type` pattern, placed right after `TeamRow`.
- `MembershipRow` gained `workspace_id: string | null`.
- `SiteRow` gained `workspace_id: string | null`.
- `ScanRow` gained `report_token: string | null` and `report_token_expires_at: Date | null`.
- No other rows/consts touched. Pre-existing baseline edit (plan-62 `crux` field on
  `ScanRow`) preserved untouched.

## Acceptance criteria — per-criterion result

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | 026 exists, applies cleanly (static; container if Docker) | PASS (static) | SQL mirrors verified existing statements from 001/003/006/012/019/025. Docker container validation NOT run — daemon unavailable (`docker version` fails: "daemon is not running"). Task permits static + typecheck in that case. |
| 2 | Exact columns/tables/indexes/constraint | PASS | See Implemented §1–7. All types/FK/on-delete/defaults match the map. |
| 3 | index.ts exposes max/WorkspaceRow/workspace_id/report_token/branding | PASS | See Implemented §2; verified by reading the file post-edit (lines 6, 52–64, 66–74, 76–80, 130–131). |
| 4 | No existing migration or unrelated type changed; typecheck + lint pass | PASS | Hash comparison vs scope-baseline.json (below). `pnpm typecheck`, `pnpm --filter db typecheck`, `pnpm lint` all green. |
| 5 | No tests modified; no code outside packages/db touched | PASS | `git status --porcelain -- packages/db` shows only the pre-existing baseline paths (AGENTS.md, index.ts, 025) + new 026. `git status` (full) shows no new paths beyond baseline inventory + this task's file. |

## Verification output (real)

`pnpm --filter db typecheck`
```
> @scanpal/db@0.1.0 typecheck C:\Users\Yassin\Desktop\scanpal\ScanPal\packages\db
> tsc --noEmit
```
→ exit 0, no diagnostics.

`pnpm typecheck` (root → `pnpm -r typecheck`)
```
Scope: 8 of 9 workspace projects
packages/db typecheck: Done
packages/shared typecheck: Done
packages/mcp-server typecheck: Done
packages/notify typecheck: Done
packages/scan-core typecheck: Done
apps/scheduler typecheck: Done
apps/worker typecheck: Done
apps/web typecheck: Done
```
→ all 8 packages green.

`pnpm lint` (root → `pnpm --filter web lint` → eslint)
```
> @scanpal/web@0.1.0 lint C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web
> eslint
```
→ exit 0, no diagnostics.

Docker validation attempt:
```
docker version --format "{{.Server.Version}}"
→ failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
  check if the path is correct and if the daemon is running
```
→ Docker daemon not running; container validation skipped per task allowance. `psql`
not installed; no offline PG parser in node_modules (`pg-query-native`, `libpg-query`,
`pg-query-emscripten` absent) — no other non-server SQL validation path exists here.

## Preservation / impact re-check

Predicate: every file listed in `scope-baseline.json` (all `packages/db/migrations/*`
+ `packages/db/src/*`) must be byte-identical (SHA-256) to baseline, except
`packages/db/src/index.ts`, which is my declared target.
Result of the comparison run (PowerShell, full file list over the baseline):

```
CHANGED FILES:
C:\Users\Yassin\Desktop\scanpal\ScanPal\packages\db\src\index.ts  BASELINE=18C9…EA8 NOW=55C4…EFC
---new files under packages/db (not in baseline)---
C:\Users\Yassin\Desktop\scanpal\ScanPal\packages\db\migrations\026_team_seats_white_label.sql
```
→ Only the intended target changed; 25 migrations (001–025) and `migrate.ts` untouched;
`026_team_seats_white_label.sql` is the only new file. (Baseline `src/index.ts` was
already modified pre-run for plan 62 — the `crux` field; the diff `git diff -- packages/db/src/index.ts`
confirms my edits are strictly additive on top of it.)

`git status --porcelain -- packages/db`
```
 M packages/db/AGENTS.md          ← pre-existing baseline (inventory line 26)
 M packages/db/src/index.ts       ← pre-existing baseline + this task
?? packages/db/migrations/025_scan_crux.sql   ← pre-existing baseline (inventory line 49)
?? packages/db/migrations/026_team_seats_white_label.sql  ← THIS TASK
```

Consumer impact: only consumers of the extended types are type-level. `planIds` is
referenced solely by `SubscriptionRow` inside `index.ts`. Row types are consumed via
casts/`as` in apps (`apps/web/lib/authz.ts:6`, `apps/web/lib/sites-core.ts:10`,
`apps/web/lib/public-status-core.ts:18` define their own local row types and do NOT
import from `packages/db`). No literal construction of the extended rows exists;
full-workspace typecheck passing across 8 packages confirms zero breakage.

## Deviations

1. **Container SQL validation not run** — Docker daemon is off; the task explicitly
   allows static verification + typecheck in that case. Noted above; recorded in
   major log.
2. **`scope-baseline.json` path differed from the task brief** (`DeepSeekAndDestroy/
   plans/…/runs/…/phases/phase-1/phase-1-task-1-migration-026-4f7b/scope-baseline.json`
   vs the brief's `phases/phase-1/…`). Located by recursive search; content unchanged.
3. **`default '{}'::jsonb` instead of literal `default '{}'`** for `teams.branding` —
   the map's text was `'{}'`, but the repo's established jsonb-default style is
   `'{}'::jsonb` (`001:49`, `025:7`); criterion 1 mandates "exact column types/quoting
   of the existing migrations", so the cast is kept. Semantically identical.

## Collateral impact

None found. No migration, test, or file outside `packages/db` was modified. The only
new paths in the full `git status --porcelain` beyond the baseline inventory
(`changed-paths-inventory.txt`) are the `026` migration and this report/log files.

## Major findings / fixes log

`ml-20260818-1` — see `major-findings-and-fixes.md` (appended alongside this report).
