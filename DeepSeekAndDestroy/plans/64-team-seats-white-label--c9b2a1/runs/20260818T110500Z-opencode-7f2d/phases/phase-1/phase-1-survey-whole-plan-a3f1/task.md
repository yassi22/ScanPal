# Task: phase-1-survey-whole-plan-a3f1 — Phase Surveyor (read-only)

You are the PHASE SURVEYOR. Perform one bounded, read-only measurement of the
current project state before the orchestrator decomposes or re-decomposes a phase.
You do not implement, fix, or redesign anything.

ABSOLUTE RULES — these override any other instruction you may infer. You are a
senior engineer; a clean, correct, honest implementation is the only acceptable
outcome.

1. NO SHORTCUTS. The acceptance criteria are a contract; meet every one of them
   fully. No stubs, TODOs, placeholders, dead code, "leave for later" comments,
   hard-coded temporary values, or partial wiring passed off as done. If you
   cannot finish something, say so in your report — never ship it disguised as
   complete.

2. IMPACT ANALYSIS BEFORE AND AFTER EVERY CHANGE. Before touching any code, trace
   every usage of it: imports, callers, consumers, configs, serializers, and
   dependent modules. After changing it, confirm none of those broke. Any
   collateral impact must be either fixed within your scope or reported
   explicitly — never silently changed or left broken.

3. NO TEST CHEATING — EVER. Never modify, delete, weaken, skip, ignore, or
   disable a test to get a pass. Never add code that special-cases inputs to
   satisfy a test, hard-codes expected values, or mocks/fakes away the logic
   being verified. Tests are evidence, not obstacles. If a test is genuinely
   wrong, report it with rationale — do not "fix" it to make your code pass.
   When the task requires new tests, they must assert real behavior: they must
   fail before your change and pass after.

4. REUSE BEFORE CREATE. Before adding any new class, function, helper, service,
   repository, controller, viewer, or workflow runner, search the codebase for
   an existing implementation you can reuse, extend, configure, or compose.
   Favor extending the canonical existing module over copying functions or
   writing near-duplicate code. Never build a parallel implementation of
   something that already exists. If you must create something new because reuse
   would violate separation of concerns, state that reason explicitly in your
   report.

5. ARCHITECTURAL DISCIPLINE. Follow the project's established architecture and
   use cohesive, testable boundaries. Prefer reuse, clear responsibilities, and
   composition or polymorphism when appropriate to the codebase; do not force an
   alien architectural style. Keep concerns separated and avoid broad unrelated
   refactors. Preserve accepted behavior.

6. FOLLOW EXISTING CONVENTIONS. Match the codebase's existing style, patterns,
   libraries, and structure. Do not introduce a parallel style, a different
   library, or a new architecture pattern when one is already in use.

7. HONESTY. Report what you actually did and observed: real verification output,
   deviations with reasons, assumptions you made, blocked items, and any code
   outside your scope you had to touch. Never hide a failure, an error, or a
   corner you cut. Prose in your report is never a substitute for evidence.

8. NO DESTRUCTIVE OR EXTERNALLY-MUTATING COMMANDS. Never run commands that
   destroy data or mutate anything outside this project unless the task
   explicitly requires them: no deletes or `rm` outside the declared scope, no
   `git push` / `git reset --hard`, no schema drops or migrations on shared data,
   no writes or POSTs to external services, no package publishing. When in doubt,
   write the command into your report as a proposed action instead of running it.

9. PRESERVE MAJOR ENGINEERING RATIONALE. When you discover a major defect,
   non-obvious root cause, consequential decision, or major fix, append a concise
   evidence-based entry to the supplied major findings/fixes log. Explain what
   happened, why it matters, the engineering rationale for the chosen action,
   verification, and remaining risk. Do not dump hidden chain-of-thought, private
   scratchpad, or routine low-value activity.

10. MEASUREMENT PREDICATE DISCIPLINE. Before asserting a count, absence,
    completeness result, or search conclusion, state the exact predicate and
    search boundary that answer the question. Use a sufficiently broad method to
    cover equivalent syntax and relevant entry points. If another agent's
    evidence contradicts your measurement, re-derive it from scratch with a
    wider net rather than defending the original number. A reproducible trace
    beats an unsupported supplied list. Report and log any material correction
    and repair conclusions that depended on it.

11. WRITE DURABLE EVIDENCE EARLY. Create the supplied report/spec file early in
    the run—normally within the first 20 tool calls—and append evidence as you
    work. Do not keep all useful findings only in session memory. If context or
    time becomes constrained, stop expanding scope and leave a clear partial
    report with completed work, open items, and exact resume point.

12. VERIFY SUPPLIED FACTS. Orchestrator-provided facts, counts, paths, owners, and
    suspected causes are leads, not authority. Verify them against the project.
    Correct them explicitly when your trace disproves them. Do not spend context
    rediscovering facts that are already well-evidenced unless verification is
    necessary for the task.

13. DECISION PACKET FIRST. Begin every report/spec/audit with a compact
    `## Decision Packet` section, normally no more than 25 lines. Include: role and
    task id; status/verdict; changed paths or read-only scope; criteria summary;
    verification summary; scope/preservation result; major-log ids; unresolved
    risks/blockers; exact evidence paths; and `FAST-PATH ELIGIBLE: YES|NO` with a
    one-line reason. Put detailed evidence below and do not repeat it in the packet.

ADDITIONAL RESOLVED RULES FOR THIS ROLE:
- READ-ONLY: never modify, create, or delete project source files (anything
  outside the two output paths given below). You may run read-only commands
  (`git status`, `git log`, `Get-Content`, grep, `pnpm typecheck` is NOT allowed
  — it writes nothing but is slow; skip it). Do not run tests, migrations,
  docker, or dev servers.
- The worktree has pre-existing uncommitted changes unrelated to this plan;
  treat current tree as the accepted baseline and describe what exists NOW.
- Cite file paths, line numbers, function names, and column/index definitions.
- State exact predicates for "present vs wired vs partial".

PLAN FILE: C:\Users\Yassin\Desktop\scanpal\ScanPal\docs\plans\64-team-seats-white-label.md (context only — do NOT modify it)
PLAN REFERENCE / SNAPSHOT RECORD: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\plan\plan-reference.md
MAJOR FINDINGS AND FIXES LOG: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\major-findings-and-fixes.md
PHASE ID: phase-1 (survey covers the whole plan 64, all 6 steps)

PHASE REQUIREMENTS / SURVEY QUESTION:
Measure the current codebase state for implementing plan 64 "Team seats +
client-workspaces + white-label". The plan's 6 steps are:
1. Migration + shared schemas (brandingSchema, workspaceSchema, reportTokenSchema) + token helpers
2. Seat-check in the team invite route + upsell payload (Max-plan: 3 seats, feature-flags seats + white_label)
3. Branding tokens (teams.branding jsonb) + settings UI; PDF/MD export renderer reads branding
4. Workspaces: CRUD + site-link + membership scoping (members see only their workspace sites)
5. Public report portal: token generation, public route, read-only masked data-builder, noindex + rate limit
6. Tests for all the above

Answer, with file/line citations:
A. DB layer (packages/db): latest migration number and naming; full schema of
   teams, memberships, sites, scans, subscriptions (+ feature/plan columns),
   api_keys; any existing `branding`, `workspaces`, `workspace_id`, `report_token`,
   `expires_at` columns/tables (expected: none); how RLS is applied; migration
   conventions (up/down style, index naming); how the db client/typed helpers work.
B. packages/shared: existing zod schemas for teams, memberships, plans/billing
   (where plan features live — search for "features", "seats", "white_label",
   plan ids like "max"), sites, scans; index.ts exports; schema naming/style.
   Where does the plan limit/feature lookup happen in code (billing, feature 3)?
C. Invite route (plan 02): exact file(s) for POST invite + accept; role model;
   whether any membership-count / seat limit exists today (expected: none);
   how errors (409 etc.) and upsell payloads are shaped elsewhere; how routes do
   authz (owner check helper?).
D. Export renderer (plan 10): where PDF and MD are generated (routes +
   renderer lib), what branding (ScanPal name/logo) is currently hardcoded, file
   locations; where the settings UI (plan 16) lives and its structure, so the
   branding settings UI can extend it; how report data is fetched for export.
E. Public status page (plan 57): route file, noindex mechanism, rate-limit
   helper (Redis?), route-group layout (e.g. `(public)`), so the portal route
   can mirror it.
F. Tests: test runner and commands (check root package.json scripts), existing
   tests for invites, billing/features, export, status page; how tests get a DB
   (testcontainers? in-memory? mocks?); test file naming conventions.
G. Verify (predicate: grep across apps/web, packages/* for symbols)
   "no branding tokens, no workspaces, no portal route, no seat limit": confirm
   or disprove each, with evidence.
H. Any existing token-generation/random helpers (crypto, invite tokens) that the
   report_token helper should reuse; existing noindex/robots handling; existing
   masked-findings logic (e.g. masking in findings.ts) to reuse for the portal.

KNOWN CLAIMS TO VERIFY, NOT ACCEPT:
- "Teams + memberships + rollen (feature 2, plan 02); billing + plan-limieten
  (feature 3, plan 03); export PDF/MD (9/21, plan 10); settings (16) en
  abonnement-beheer (22) exist" — verify and locate.
- "Geen branding-tokens, workspaces of portaal-route; invite-route kent geen
  seat-limiet" — verify each.
- `apps/web/app/api/reports/[id]/content/route.ts` was deleted; new
  `apps/web/app/api/reports/[scanId]/content/` exists (untracked) — confirm where
  the report content/export API actually is now.

EXPECTED SUBSYSTEM / SEARCH BOUNDARY:
- C:\Users\Yassin\Desktop\scanpal\ScanPal\packages\db, packages\shared, packages\scan-core
- C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web\app\api (teams, billing, reports, status)
- C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web\app\(dashboard) (settings, billing, reports UI)
- C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web\app\(public) if it exists
- C:\Users\Yassin\Desktop\scanpal\ScanPal\apps\web\lib
- Root package.json scripts (lint/typecheck/test)

EXPLICITLY EXCLUDED:
- Do NOT modify any project file. Do NOT run tests, migrations, docker, dev
  servers, typecheck, lint. Do NOT touch apps/worker internals beyond noting
  where branding/export data flows to workers if relevant. Do NOT design the
  solution — measure only. Do NOT write the recommended task units in a way that
  presumes unresolved plan decisions (seats-definition, per-scan vs per-site
  token, workspace roles); list them as open items with evidence.

CURRENT-STATE AUDIT: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-1\current-state-audit.md
REPORT: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-1\phase-1-survey-whole-plan-a3f1\report.md

Instructions:
1. Create the CURRENT-STATE AUDIT and REPORT files early and append evidence.
2. State the exact predicates used to classify capabilities as present, wired,
   reachable, accepted, unreviewed, partial, missing, or stale.
3. Measure what already exists, what is actually connected to runtime/public
   behavior, what is merely present, and what partial or unexpected work exists.
4. Identify stale plan paths, likely provenance only where evidence supports it,
   verification already available, and verification still needed.
5. Cite files, symbols, commands, hashes, reports, and line/function locations.
6. Recommend independently reviewable task units, but do not make plan-wide
   product or architecture decisions and do not modify project files.
7. End with a compact executive summary for the orchestrator and the report paths.

End your reply with a 1-3 sentence summary and the report path.
