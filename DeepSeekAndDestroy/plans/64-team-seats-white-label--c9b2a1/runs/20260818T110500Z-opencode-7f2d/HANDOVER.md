# Handover — Run 20260818T110500Z-opencode-7f2d

## Identity
- Plan id: `64-team-seats-white-label--c9b2a1` — source `docs/plans/64-team-seats-white-label.md`
- Run: `20260818T110500Z-opencode-7f2d` (opencode orchestrator, fresh run)
- Project worktree: `C:/Users/Yassin/Desktop/scanpal/ScanPal` (git repo, branch: default; worktree has pre-existing uncommitted changes from earlier work — treat as accepted baseline)
- Snapshot: `plan/snapshots/0001-intake-64-team-seats-white-label.md` (SHA256 BA7529...A050)

## Mission
Execute plan 64 "Team seats + client-workspaces + white-label (Max-plan)" end-to-end: 6 steps → migration/shared schemas, seat-check invite + upsell, branding tokens + settings UI + PDF/MD branding, workspaces CRUD/scoping, public report portal (token), tests. Acceptance criteria in plan.

## Decisions so far
- Plan has open questions (seats-definition incl. owner? per-scan vs per-site token? workspace roles?) — resolve from plan authority + codebase evidence during survey, record in major log; escalate only if genuinely unresolvable.
- Worker profile: opencode CLI, model `opencode-go/deepseek-v4-flash`, ephemeral `OPENCODE_DB` per worker, `--auto`, cwd = project worktree.
- Orchestrator harness: opencode; adapter installed (`.opencode/plugins/dsd-compaction.ts`, `DeepSeekAndDestroy/tools/context_checkpoint.py`); manual safe-boundary checkpoint mode (no context % visible).
- Python launcher on this machine is `python` (3.12), NOT `python3`/`py`.

## Current state
- Intake complete; state.json written; authority-index hashed (AGENTS.md set, plans 02/03/10/16/57, FEATURES/ROADMAP).
- Phase structure: phases mirror plan steps 1–6. Phase 1 = step 1 (migration + shared schemas + token helpers).
- **Survey ACCEPTED (fast path)** — task phase-1-survey-whole-plan-a3f1. Audit: `phases/phase-1/current-state-audit.md`. Key corrections/decisions in major log MFL-001/002/003:
  - Seat limit ALREADY EXISTS (`apps/web/lib/invites-core.ts:62-87`, `member_limit` → 400, no upsell). Step 2 = modification (409 + upsell) + Max plan (greenfield).
  - Branding/workspaces/portal: confirmed missing. Next migration = 026. RLS only on subset of tables (024). Plans: free/pro only (`subscriptions.plan` check `003:8`, `planIdSchema` `plans.ts:3`, Stripe `billing.ts:24-29`).
  - Decisions: seats = accepted memberships incl. owner, limit = `features.seats ?? maxMembers`; token per-scan on `scans.report_token(+_expires_at)` 32-hex, on-demand share; workspace = single member role via `memberships.workspace_id` nullable, owner sees all, unassigned member sees nothing.
  - Export: `apps/web/lib/report/{data,pdf,markdown,store}.ts`; branding hardcoded `pdf.tsx:138,215`, `markdown.ts:46,124`; content route = untracked `api/reports/[scanId]/content/route.ts`.
  - Public portal template: `(public)/status/[slug]/page.tsx` + `api/public/status/[slug]/route.ts` (noindex, rate-limit via `lib/rate-limit.ts`, `lib/public-status-core.ts`). Token helpers: `generatePublicStatusSlug` in `shared/public-status.ts:51-61`.
  - Tests: vitest (root `pnpm test` → `pnpm --filter web test`), fakePool/vi.mock patterns, naming `*-core.test.ts`/`*-route.test.ts`.
- Phase 1 tasks: task-1 migration 026 + db types (prepared, next launch); task-2 shared schemas (branding/workspace/report-tokens) + token helper.
- Phase plan: P2 seat 409+upsell + Max plan billing wiring; P3 branding tokens + settings UI + renderers; P4 workspaces CRUD + scoping; P5 portal; P6 verification + docs status.

## RESUME 2026-08-18 — continuation after Claude handover
- Profile changed per user: orchestrator = Claude Code (Opus); workers = Claude `Agent` tool subagents,
  model=sonnet. Fresh Agent call = fresh worker; reviewer repair via `SendMessage` to its agent id.
  Read worker verdicts from the on-disk report (`grep '^VERDICT:' review-N.md`), not the agent's return text.
- Prior OpenCode worker PIDs dead; no live worker inherited. Run id keeps `-opencode-` slug for paths only.
- PHASE-1: approved. **PHASE-2: APPROVED (MFL-019)** — all tasks A-E accepted via independent Sonnet
  review (MFL-011/013/015/016/017/018); phase auditor AUDIT: READY, all 5 integration chains intact,
  full suite green (shared 571, web 601, typecheck 8/8, lint clean). Max plan fully wired + invite
  409+upsell live. Phase-2 decisions were locked in MFL-010; construction spec =
  phase-2-billing-discovery-6e0b/discovery-spec.md.
- **PHASE-3: APPROVED** — branding tokens, owner settings, plan gate and PDF/Markdown/public-report
  branding are implemented. The replacement construction spec is at
  `phases/phase-3/phase-3-branding-discovery/discovery-spec.md`.
- **PHASE-4: APPROVED** — workspace CRUD, site/member assignment and member workspace scoping are
  implemented. Owners retain team-wide visibility; unassigned members see no sites.
- **PHASE-5: APPROVED** — per-scan share tokens, optional expiry, public read-only masked report,
  noindex headers/metadata and IP rate limiting are implemented.
- **PHASE-6: APPROVED** — docs/status updated; web typecheck, package typechecks, targeted new tests,
  full web suite (607 tests) and `git diff --check` passed.
- Scope baselines are content-hash (scope_snapshot.py capture --include-git-changes …) — REFRESH before
  EACH mutating task (tree changes every accepted task). Editing on UNCOMMITTED `main` (single run, no
  concurrency); do NOT commit (baseline mixes other plans' uncommitted work; no user auth to commit).
  Because of that, `git diff HEAD` bundles all tasks — rely on the per-task content-hash baseline for scope.
- No implementation phases remain.

## Next action (exact)
- COMPLETE. The repository remains intentionally uncommitted because the original run contained a
  large accepted uncommitted baseline; review and commit the complete diff as focused commits when
  the owner is ready.
