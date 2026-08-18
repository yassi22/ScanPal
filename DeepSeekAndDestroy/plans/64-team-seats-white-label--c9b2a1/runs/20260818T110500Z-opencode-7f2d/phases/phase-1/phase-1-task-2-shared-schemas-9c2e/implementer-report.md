# Implementer Report — phase-1-task-2-shared-schemas-9c2e

## Decision Packet

- **Role**: Implementer · **Task**: phase-1-task-2-shared-schemas-9c2e (shared contracts, plan 64 step 1 part 2)
- **Status**: DONE — all acceptance criteria PASS
- **Changed paths** (5, exactly the declared scope):
  1. `packages/shared/src/branding.ts` (new)
  2. `packages/shared/src/workspaces.ts` (new)
  3. `packages/shared/src/report-tokens.ts` (new)
  4. `packages/shared/src/index.ts` (extended — 3 additive `export *` lines, appended at end; baseline `crux`/`mcp-tools` export lines left untouched)
  5. `packages/shared/src/__tests__/report-tokens.test.ts` (new)
- **Criteria summary**: C1 PASS · C2 PASS · C3 PASS · C4 PASS · C5 PASS — details below.
- **Verification summary**: shared tests `38 files / 557 tests passed` (incl. new file, 16 tests); root `pnpm typecheck` green for all 8 packages; `pnpm lint` green. SHA-256 scope-baseline compare: only `index.ts` changed among baseline files + 4 new files; `plans.ts`, `public-status.ts`, `report.ts` byte-identical; no baseline file absent.
- **Scope/preservation result**: `plans.ts`, `public-status.ts` untouched; no existing shared file edited except `index.ts` (additive). Pre-existing worktree baseline (plans 62/63, MFL-20260818-001/002 work) preserved untouched.
- **Major-log ids**: MFL-20260818-006 (token entropy source decision + survey correction)
- **Unresolved risks/blockers**: none. Note: `scope-baseline.json` lives in the orchestrator run dir (`DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-1/phase-1-task-2-shared-schemas-9c2e/scope-baseline.json`), NOT at `phases/phase-1/…` — located via glob.
- **Evidence paths**:
  - This report
  - `packages/shared/src/__tests__/report-tokens.test.ts`
  - SHA-256 compare output (below)
  - `git diff -- packages/shared/src/index.ts`
- **FAST-PATH ELIGIBLE**: NO — implementation task with required verification; already complete.

---

## What I implemented

Three new contract modules in `packages/shared/src`, matching the house style verified from
`public-status.ts`, `report.ts`, `index.ts` (plain `z.object`, no `.strict()`; `export type X =
z.infer<typeof xSchema>`; Dutch JSDoc; length constant exported):

- **`branding.ts`** — `brandingSchema` with `logo_url` (`z.string().url().max(2048).nullable().optional()`),
  `primary_color` (regex `^#[0-9a-fA-F]{6}$`, nullable/optional), `report_name`
  (`trim().max(120)`, nullable/optional), `hide_branding` (`z.boolean().default(false)` → type is
  non-optional, matching the `inviteInputSchema.role` `.default()` precedent). `{}` (the DB default)
  validates. `export type Branding`.
- **`workspaces.ts`** — `createWorkspaceSchema` (input: `{ name: trim().min(1).max(80) }`),
  `workspaceSchema` (full DB row: `id` uuid, `parent_team_id` uuid, `name`, `created_at` datetime),
  `workspaceUpdateSchema` (rename-only PATCH, `name` required non-empty — mirrors the
  `roleChangeSchema` PATCH precedent). Types `CreateWorkspace`, `Workspace`, `WorkspaceUpdate`.
- **`report-tokens.ts`** — `REPORT_TOKEN_LENGTH = 32`, `REPORT_TOKEN_PATTERN = /^[0-9a-f]{32}$/`,
  `generateReportToken()` (32 lowercase hex chars via global `crypto.randomUUID().replace(/-/g,"")`,
  the exact `generatePublicStatusSlug` technique), `isValidReportToken(token)`,
  `reportTokenSchema` (`{ token, expires_at }`, `expires_at` nullable+optional datetime).
  Type `ReportToken`. (Single schema instead of a duplicate `reportTokenResponseSchema`: the map
  resolved the response shape to data-only `token + expires_at`, which is identical to
  `reportTokenSchema`; the URL is phase-5 route assembly.)
- **`index.ts`** — 3 additive `export *` lines appended after `./mcp-tools`.
- **`__tests__/report-tokens.test.ts`** — 16 tests: generator format + 1000-call uniqueness;
  validator accepts valid / rejects wrong-length, uppercase, non-hex, empty; `reportTokenSchema`
  accepts token without/with `expires_at` (ISO + null), rejects invalid/uppercase/missing token;
  `brandingSchema` accepts `{}` and a full object, rejects bad `primary_color` and bad `logo_url`;
  `workspaceSchema`/`createWorkspaceSchema` contract (valid, empty/81-char name, full row).

## Per-criterion results

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Schemas + helpers in own files, re-exported from index | **PASS** | Files listed above; `grep 'export \* from "./(branding\|workspaces\|report-tokens)"' src/index.ts` → 3 matches (lines 149–151). |
| 2 | Schemas validate plan-64 contract | **PASS** | Test file asserts `{}` branding valid, full branding valid, bad hex color rejected, bad URL rejected, workspace name non-empty/≤80, token exactly 32 lowercase hex, `expires_at` optional/nullable, helpers per contract. All green. |
| 3 | All types inferred + exported (z.infer) | **PASS** | `Branding`, `CreateWorkspace`, `Workspace`, `WorkspaceUpdate`, `ReportToken` exported; `pnpm typecheck` green proves infer-ability. |
| 4 | Shared-package tests green incl. new file | **PASS** | `pnpm --filter @scanpal/shared test` → 38 files / 557 tests passed (report-tokens.test.ts: 16 tests). |
| 5 | Root typecheck + lint pass; no test modified; scope clean | **PASS** | `pnpm typecheck` green (8 packages); `pnpm lint` green; no existing test touched; SHA-256 compare vs scope-baseline.json: only `index.ts` changed + 4 new files. |

## Verification output (real)

### 1. `pnpm --filter @scanpal/shared test` (final run)
```
Test Files  38 passed (38)
     Tests  557 passed (557)
   Duration 4.65s (…)
```
New file: `src/__tests__/report-tokens.test.ts (16 tests)` ✓ (also passed on first run before the
generator fix — see deviation below).

### 2. `pnpm typecheck` (root, `pnpm -r typecheck`)
All 8 workspace projects `Done`: packages/db, packages/shared, packages/mcp-server,
packages/notify, packages/scan-core, apps/scheduler, apps/web, apps/worker.

### 3. `pnpm lint` (root script = `pnpm --filter web lint`)
```
> @scanpal/web@0.1.0 lint
> eslint
```
Exit 0, no findings.

### 4. Scope verification
`git status --porcelain` shows only the pre-existing worktree baseline + my 5 paths
(`?? branding.ts`, `?? workspaces.ts`, `?? report-tokens.ts`, `?? report-tokens.test.ts`,
`M index.ts`). `git diff -- packages/shared/src/index.ts` = 5 insertions, of which
`./crux` + `./mcp-tools` are the pre-existing baseline and the last 3 (`./branding`,
`./workspaces`, `./report-tokens`) are mine.

SHA-256 compare vs `scope-baseline.json` (captured 13:30, run dir):
- CHANGED among baseline files: only `packages/shared/src/index.ts`
- NEW files absent from baseline: `branding.ts`, `workspaces.ts`, `report-tokens.ts`,
  `__tests__/report-tokens.test.ts` (exactly the declared 4 new paths)
- ABSENT-NOW: none; `plans.ts`, `public-status.ts`, `report.ts` byte-identical (also clean in
  `git status --porcelain`)

## Deviations (with reason)

1. **Token entropy source**: the map prescribed `randomBytes(16)` via `node:crypto`, citing
   `public-status.ts` as the precedent. That file actually uses the global `crypto.randomUUID()`
   (no import), and the environment's global `crypto` is typed as only `{ randomUUID(): string }`
   (`globals.d.ts`). A first implementation with `crypto.getRandomValues` failed typecheck
   (`TS2339: Property 'getRandomValues' does not exist` / `TS18046: 'byte' is of type 'unknown'`).
   Final: `crypto.randomUUID().replace(/-/g, "")` → exactly 32 lowercase hex chars (v4 UUID, 122
   bits entropy), identical technique to the canonical slug generator, zero new imports/type
   surface (keeps `packages/shared` zod-only). Logged as MFL-20260818-006.
2. **No `reportTokenResponseSchema`**: the map named it but resolved its shape to data-only
   (`token + expires_at`), which is exactly `reportTokenSchema`. One schema; the public URL is
   phase-5 route assembly.
3. **`scope-baseline.json` location**: not under `phases/phase-1/…` in the worktree — found under
   `DeepSeekAndDestroy/…/runs/20260818T110500Z-opencode-7f2d/phases/phase-1/…` via glob.

## Collateral impact

None. No consumers exist yet by design (phases 2–5). All existing shared exports untouched;
`plans.ts`/`public-status.ts`/`report.ts` byte-identical; baseline worktree edits (plans 62/63,
MFL-20260818-001/002) untouched. No test modified; the new test fails against a wrong contract
(verified logic: validator rejects non-32-hex, schema rejects uppercase/invalid tokens).

## Major log

MFL-20260818-006 appended — token generation decision + survey correction, with typecheck-failure
evidence.
