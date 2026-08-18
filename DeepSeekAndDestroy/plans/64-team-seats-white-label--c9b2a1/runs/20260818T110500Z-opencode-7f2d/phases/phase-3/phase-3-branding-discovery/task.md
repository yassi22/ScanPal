# Phase-3 Branding Discovery — Discovery Worker (Sonnet 5, READ-ONLY)

Produce a CONSTRUCTION-READY spec (like the phase-2 billing discovery spec) for plan-64 **step 3**:
white-label branding — branding tokens + settings UI + PDF/MD renderers read branding. You write a spec
to disk and STOP. You do NOT implement anything.

Repo root: C:/Users/Yassin/Desktop/scanpal/ScanPal (git, branch `main`; large accepted uncommitted
baseline — phases 1-2 are DONE/approved, do not re-litigate them).

## Plan authority (read these)
- `docs/plans/64-team-seats-white-label.md` — step 3 + the branding acceptance criterion:
  "White-label-branding (logo, kleur, naam, hide-branding) zit in PDF en MD; geen ScanPal-naam bij
  hide_branding." Contract lines: `teams.branding jsonb`; `PATCH /api/teams/[id]/branding` (owner) →
  zod `brandingSchema`; branding = `{ logo_url, primary_color, report_name, hide_branding bool }`.
- `docs/plans/10-export.md` (the PDF/MD export this extends) and `docs/plans/16-billing-admin.md`
  (settings UI home).
- Phase-1 whole-plan audit (has the branding/export facts already):
  `DeepSeekAndDestroy/plans/64-team-seats-white-label--c9b2a1/runs/20260818T110500Z-opencode-7f2d/phases/phase-1/current-state-audit.md`
- Decisions so far: `.../major-findings-and-fixes.md` (esp. MFL-003 white_label feature, MFL-010).
- Migration 026 (`packages/db/migrations/026_team_seats_white_label.sql`) added `teams.branding jsonb`.
- Phase-1 task-2 added shared schemas — FIND the `brandingSchema` it created in `packages/shared/src/`
  and document its EXACT shape (fields, types, defaults, validation).

## Questions to answer with file:line citations
1. **Branding data model:** exact `brandingSchema` shape (from phase-1 task-2) + the `teams.branding`
   column (migration 026) + the db types (`packages/db/src/index.ts` TeamRow?). Are they consistent?
2. **PDF renderer:** `apps/web/lib/report/pdf.tsx` — where is ScanPal branding hardcoded (phase-1 audit
   cited ~:138,215)? What is the render entry signature, and where would team branding be injected
   (logo_url image, primary_color, report_name title, hide_branding → suppress ScanPal name)?
3. **Markdown renderer:** `apps/web/lib/report/markdown.ts` — hardcoded branding (~:46,124)? Same
   injection questions.
4. **Report data builder:** `apps/web/lib/report/data.ts` (+ `store.ts`) — where report data is
   assembled; is the team/teamId available there to load branding? What's the cleanest place to fetch
   `teams.branding` and thread it into both renderers?
5. **Settings UI:** where does team settings live (plan 16 — a settings page/component under
   `apps/web/app` + a component like `team-settings.tsx`)? What's the existing pattern for a team PATCH
   route + owner authz (cite an existing `PATCH /api/teams/[id]/...` route to mirror)? Where would a
   branding form section + the `PATCH /api/teams/[teamId]/branding` route go?
6. **white_label gate:** branding editing / hide_branding should be gated to plans with
   `features.white_label` (max only). Where/how to enforce (route-level assertPlanFeature-style +
   UI-level)? Note: `assertPlanFeature` currently keys on the 4 boolean features
   (uptime/github/activeTests/onDeploy) — does `white_label` need adding to that helper, or a separate
   check? Cite `packages/scan-core/src/credits.ts` assertPlanFeature.
7. **Test seams:** how are pdf.tsx / markdown.ts / report data currently tested? fakePool/vi.mock
   patterns, snapshot style, file locations. What tests must fail-before/pass-after for branding?
8. **Open decisions for the orchestrator** (list them with your recommendation): e.g. logo_url handling
   (URL string only vs upload — plan implies URL string), primary_color format/validation, default
   report_name, whether hide_branding also hides in the public portal (phase 5), how branding is loaded
   for the export (per-request team fetch vs passed in).

## Also produce
- **Construction-ready task units** (like billing §3): split phase-3 into independently reviewable units
  (recommend: Unit 1 = branding fetch/thread-through in report data + both renderers; Unit 2 = PATCH
  branding route + white_label gate; Unit 3 = settings-UI branding form). Give exact files, boundaries,
  non-goals, first edit, and per-unit verification commands.
- **Verification commands** and **merge/commit boundaries**.

## Report
Write the spec to `.../phases/phase-3/phase-3-branding-discovery/discovery-spec.md` with a Decision
Packet at the top (Role · Status · Changed paths=none · Criteria=Q1-8 answered · Verification summary of
what you read/grepped · Scope=read-only · Open decisions · FAST-PATH ELIGIBLE: NO if decisions remain).
READ-ONLY: change no source, no commit, edit no DeepSeekAndDestroy file except discovery-spec.md (and
optionally a report.md). End with COMPLETE + the spec path.
