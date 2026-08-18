# Review 1 — phase-1-task-2-shared-schemas-9c2e

## Decision Packet

- **Role**: Reviewer (round 1) · **Task**: phase-1-task-2-shared-schemas-9c2e (shared contracts, plan 64 step 1 part 2)
- **Status/verdict**: **PASS**
- **Changed paths** (review read-only; no project files modified by reviewer):
  - Declared scope (5): `packages/shared/src/branding.ts` (new), `workspaces.ts` (new), `report-tokens.ts` (new), `__tests__/report-tokens.test.ts` (new), `src/index.ts` (+3 additive export lines)
- **Criteria summary**: C1 PASS · C2 PASS · C3 PASS · C4 PASS · C5 PASS — full evidence below.
- **Verification summary**: `pnpm --filter @scanpal/shared test` → **38 files / 557 tests passed** (incl. report-tokens.test.ts, 16 tests); root `pnpm typecheck` → 8 packages all `Done`; `pnpm lint` → exit 0, no findings; independent direct Node probe of all helpers/schemas passed (both accept-valid and reject-invalid directions); SHA-256 scope compare → only `index.ts` changed among baseline files + exactly the 4 new files; baseline `index.ts` reconstructed byte-for-byte from current minus the 3 new export lines (hash `F9ED65…` matches).
- **Scope/preservation result**: `plans.ts`, `public-status.ts`, `report.ts` byte-identical to scope-baseline.json; no existing shared file edited except `index.ts` (3 additive export lines); no existing test modified; git status delta vs baseline inventory = exactly the 4 new shared paths.
- **Major-log ids**: MFL-20260818-006 (verified, accepted); MFL-20260818-007 (reviewer re-verification appended).
- **Unresolved risks/blockers**: none task-relevant. (MFL-006 note: 122-bit vs 128-bit token entropy — judged acceptable, see §Deviations.)
- **Evidence paths**:
  - This file
  - `packages/shared/src/{branding,workspaces,report-tokens}.ts`, `packages/shared/src/index.ts`, `packages/shared/src/__tests__/report-tokens.test.ts`
  - Run outputs recorded below (test/typecheck/lint, hash compare, direct node probe)
  - `scope-baseline.json`, `changed-paths-inventory.txt`, `changed-paths-after.txt` in this task dir
- **FAST-PATH ELIGIBLE**: **YES** — independent review, all required verification complete and green, scope/preservation evidence clean, no conflict requiring orchestrator investigation.

---

## Files inspected

- `packages/shared/src/branding.ts` (18 lines), `workspaces.ts` (27), `report-tokens.ts` (37), `__tests__/report-tokens.test.ts` (134), `src/index.ts` (full), `src/public-status.ts` (house-style reference), `src/globals.d.ts` (crypto typing), `packages/shared/package.json` (package name `@scanpal/shared`, zod ^4, vitest).

## Criterion 1 — files + re-exports

- `brandingSchema` + `type Branding` in `branding.ts:8,18`; `createWorkspaceSchema`/`workspaceSchema`/`workspaceUpdateSchema` + types `CreateWorkspace`/`Workspace`/`WorkspaceUpdate` in `workspaces.ts:9-27`; `reportTokenSchema` + `type ReportToken`, `generateReportToken`, `isValidReportToken`, `REPORT_TOKEN_LENGTH`, `REPORT_TOKEN_PATTERN` in `report-tokens.ts:10-37`.
- Re-exported from `src/index.ts:149-151` (`export * from "./branding"; ./workspaces; ./report-tokens;`), appended at end, same style as the 40+ existing `export *` lines. **PASS.**

## Criterion 2 — contract validation

- **Direct node probe (independent of the test suite, Node v24):**
  - `generateReportToken()`: length 32, `^[0-9a-f]{32}$` ✓, unique across calls ✓, valid per `reportTokenSchema` ✓, accepted by `isValidReportToken` ✓; `isValidReportToken(upper)` = false, `isValidReportToken("g"*32)` = false ✓.
  - `brandingSchema`: `{}` valid ✓, full object (logo_url/primary_color/report_name/hide_branding) valid ✓, bad hex `#12345` rejected ✓, bad URL `x` rejected ✓, `parse({}).hide_branding === false` ✓.
  - `createWorkspaceSchema`: `"W"` valid, `" "` rejected, 81-char rejected ✓; `workspaceUpdateSchema` `{name:"Z"}` valid ✓; `workspaceSchema` full DB row valid ✓.
- `hide_branding: z.boolean().default(false)` → `{}` still parses (DB default `'{}'` valid) and output type is non-optional (`parse({}).hide_branding === false`), matching the `inviteInputSchema.role` `.default()` precedent (`index.ts:75`); later-phase consumers can read `branding.hide_branding` without optional-chaining (risk hypothesis 3 resolved). **PASS.**

## Criterion 3 — types inferred + exported

- `z.infer` types exported per house style; root `pnpm typecheck` (8 packages incl. shared) all `Done` proves infer-ability and export integrity. **PASS.**

## Criterion 4 — test/typecheck/lint green, no existing test modified

- **Real output — `pnpm --filter @scanpal/shared test`** (run 13:41): `Test Files 38 passed (38)`, `Tests 557 passed (557)`, incl. `src/__tests__/report-tokens.test.ts (16 tests)`. All 38 files green; no skips.
- **Real output — `pnpm typecheck`** (root = `pnpm -r typecheck`, 8 of 9 projects): packages/db, packages/shared, packages/mcp-server, packages/notify, packages/scan-core, apps/scheduler, apps/web, apps/worker → all `Done`, no errors.
- **Real output — `pnpm lint`** (root = `pnpm --filter web lint` → `eslint`): exit 0, no findings.
- No existing test file modified: SHA-256 compare shows every baseline `__tests__/*` file unchanged; the only new test file is `report-tokens.test.ts`. **PASS.**

### Test integrity audit

- Tests assert both directions (accept valid + reject invalid) for the validator, the schema, branding, and workspace shapes; generator tests assert format + 1000-call uniqueness against an independent fixed constant (`VALID_TOKEN`), not against the generator itself — not tautological. Any real regression (wrong length/format, validator that always returns true, required branding field, unbounded name) would fail these tests. Count check: 2+4+3+4+3 = 16 ✓.

## Criterion 5 — scope/preservation

- **SHA-256 compare vs scope-baseline.json** (run now): CHANGED among baseline files: **only `packages/shared/src/index.ts`**; NEW (absent from baseline): `branding.ts`, `report-tokens.ts`, `workspaces.ts`, `__tests__/report-tokens.test.ts` — exactly the declared 4 new paths; ABSENT-NOW: none.
- **index.ts delta is exactly 3 additive lines**: removing `export * from "./branding";`, `./workspaces;`, `./report-tokens;` from current `index.ts` and re-hashing reproduces the baseline hash `F9ED65B6FD1EF33E4824CE51AC0CB3EDA5BEB7B91351FAB9713BF9007F9AB10B` byte-for-byte (CRLF-preserving reconstruction). The `crux`/`mcp-tools` export lines are pre-existing baseline (plans 62/63, per MFL-004), confirmed present at baseline capture.
- **Explicit hashes (byte-identical to baseline):** `plans.ts` `AA835C05…` ✓, `public-status.ts` `A5E196A0…` ✓, `report.ts` `F4D9C2F4…` ✓.
- **`git status --porcelain`**: delta vs `changed-paths-inventory.txt` (baseline) = exactly the 4 new untracked shared paths (`branding.ts`, `workspaces.ts`, `report-tokens.ts`, `__tests__/report-tokens.test.ts`); `M packages/shared/src/index.ts` already in baseline. No other shared-file change. **PASS.**

## Shortcuts / stubs / TODOs audit

- `rg "TODO|FIXME|XXX|placeholder|stub|not implemented|HACK"` across the 5 changed files → **zero matches**. No hard-coded test values in source; `REPORT_TOKEN_LENGTH`/`REPORT_TOKEN_PATTERN` are the single source of truth and are used by both helper and schema.

## Impact / name-clash audit

- `rg` over `packages/**` + `apps/**` (excluding the 5 changed files) for the 14 new exported symbols (`Branding`, `Workspace`, `CreateWorkspace`, `WorkspaceUpdate`, `ReportToken`, all 4 schema constants, both helpers, 2 length/pattern constants) → **zero references**: no collisions with existing exports, no consumers yet (expected — consumers land in phases 2–5). All new exports are additive `export *` lines; typecheck green confirms no duplicate-export breakage.

## Reuse audit

- `generateReportToken()` = `crypto.randomUUID().replace(/-/g, "")` — byte-for-byte the same technique as the canonical `generatePublicStatusSlug` (`public-status.ts:51-56`); `isValidReportToken` mirrors `isValidPublicStatusSlug`. No parallel implementation, no new dependency; `packages/shared` stays zod-only per its AGENTS.md.

## Deviations review (MFL-20260818-006)

- Generator uses `crypto.randomUUID()` (global, typed as `{ randomUUID(): string }` in `globals.d.ts`) instead of the construction map's `randomBytes(16)`. Verified:
  - The map's cited precedent `public-status.ts` actually uses the UUID technique (survey fact corrected by implementer; confirmed by direct read).
  - Output is exactly the contract format `^[0-9a-f]{32}$` (32 lowercase hex), validated by both the schema and the test suite.
  - Entropy 122 bits (v4 UUID: 128 − 6 fixed version/variant bits) vs 128 — both far beyond brute-force feasibility (>64-bit decision threshold); "brute-force-proof" acceptance met.
  - Documented in MFL-20260818-006 with typecheck-failure evidence; reviewer independently confirms. **No defect.**
- `reportTokenResponseSchema` not created: response shape resolved to data-only `{ token, expires_at }`, identical to `reportTokenSchema`; URL is phase-5 route assembly. Acceptable.

## Architecture / conventions audit

- One file per contract area (`branding.ts`, `workspaces.ts`, `report-tokens.ts`), plain `z.object` (no `.strict()`), `z.infer` types, Dutch JSDoc, exported constants — consistent with `public-status.ts`, `report.ts`, `index.ts`. Test file follows `crux.test.ts` style (describe/it/expect, Dutch names). No foreign patterns introduced.

## Defect ledger

- None task-relevant. (Pre-existing baseline worktree changes, incl. plans 62/63 and the `[id]/content`→`[scanId]/content` route move documented in MFL-20260818-001/002/004, are outside this task's scope and untouched.)

## VERDICT

VERDICT: PASS
