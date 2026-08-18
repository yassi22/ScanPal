# Task: phase-2-task-A-plans-max-3b8a — Reviewer round 1

You are the REVIEWER: a strict senior reviewer and the last gate before this task
is accepted. Verify the implementation against its acceptance criteria by
inspecting the actual code and running the verification yourself. You are
authorized to read files and run commands, but during THIS pass you do NOT modify
any code and you do NOT modify any test. A "PASS" from you means the task is
genuinely done. If you FAIL the task, your findings will drive the repair. A
moderate review context is normally resumed to fix them; a heavy review context
may hand them to a fresh fixer. Therefore make every finding precise, complete,
and actionable (file, what is wrong, why, exactly what to change), and preserve
the evidence in the report rather than only in session memory.

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
- Worktree has pre-existing uncommitted baseline changes. This task's only
  changes: `packages/shared/src/plans.ts` (modified) + `packages/shared/src/
  __tests__/plans.test.ts` (new).
- Do NOT modify any project file. Run only the verification commands below.

PLAN FILE: C:\Users\Yassin\Desktop\scanpal\ScanPal\docs\plans\64-team-seats-white-label.md (context only)
PLAN REFERENCE / SNAPSHOT RECORD: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\plan\plan-reference.md
MAJOR FINDINGS AND FIXES LOG: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\major-findings-and-fixes.md
TASK ID: phase-2-task-A-plans-max-3b8a
TASK OBJECTIVE:
Extend `packages/shared/src/plans.ts`: planIdSchema free/pro/max; features gain
`seats: number | null` + `white_label: boolean`; add `max` plan (seats 3,
white_label true, maxMembers 3, creditsPerPeriod 2000, apiRatePerMinute 240,
maxWebhooks = pro's, priceCents/annual = 4× pro); planList 3 entries;
publicPlanSchema mirrors new feature fields. Free/pro values untouched except
additive seats:null/white_label:false. New/extended shared test.

ACCEPTANCE CRITERIA:
1. planIdSchema accepts free/pro/max; plans.max exists with seats 3, white_label
   true, maxMembers 3, creditsPerPeriod 2000, apiRatePerMinute 240, maxWebhooks =
   pro's value, priceCents/annual = 4× pro.
2. plans.free/pro unchanged in existing values; both gain seats: null +
   white_label: false.
3. planList = [free, pro, max]; publicPlanSchema features include seats
   (number|null) + white_label (boolean) and parse the max shape.
4. New tests pass; shared suite green; typecheck + lint green.
5. No file outside scope modified; no existing test modified.

VERIFICATION COMMANDS (run and record real output):
1. `pnpm --filter @scanpal/shared test`
2. `pnpm typecheck` (root)
3. `pnpm lint`
4. `git status --porcelain` + hash-compare vs scope-baseline.json
   (path: DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-2\phase-2-task-A-plans-max-3b8a\scope-baseline.json)
5. Grep consumers of planList/publicPlanSchema/planIdSchema across packages/* and
   apps/* — verify no consumer breaks with 3 plans (any consumer asserting 2
   plans must be listed; fix NOT in this task's scope).

IMPLEMENTER REPORT: C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-2\phase-2-task-A-plans-max-3b8a\implementer-report.md
ORCHESTRATOR EVIDENCE / CLAIMS — compact references; verify, do not accept as authority:
- Implementer claims: all criteria PASS; 568/568 shared tests; typecheck (shared,
  web, root) + lint green; index.ts byte-identical; max = 11600/116000 cents
  (4× pro), webhooks 3, api 240, credits 2000.
- Decisions MFL-20260818-010 (maxMembers 3, seats 3, display 4× pro, credits
  2000, api 240, webhooks = pro's).
TASK-SPECIFIC RISK HYPOTHESES:
1. The 4× pro math may be wrong (or pro's annual may be undefined) — verify the
   actual pro values and the arithmetic.
2. `publicPlanSchema` may not mirror the new feature fields, breaking GET /api/plans
   payload shape for consumers — check the schema + whether the new test covers it.
3. The new plans.test.ts may assert tautologies (e.g. parsing the same object the
   code built) — judge assertion meaningfulness.
EXPLICITLY EXCLUDED FROM THIS REVIEW:
- Billing/env/checkout wiring (task B), identity gates (task C), invite seat
  change (task D), pricing UI (task E). Fixing any consumer that breaks with 3
  plans (list them in the report instead).
PRIOR REVIEWS: none
KNOWN OUT-OF-SCOPE DEFECTS RELEVANT TO THIS TASK: none
PRESERVATION BASELINE: scope-baseline.json + changed-paths-inventory.txt

Review procedure — do ALL of the following:
- Create `C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-2\phase-2-task-A-plans-max-3b8a\review-1.md` early and append evidence while reviewing.
- Disregard the orchestrator's framing when necessary and independently re-derive
  whether the implementation satisfies the actual plan and contracts.
- Inspect the actual files: plans.ts (full diff vs baseline hash) + plans.test.ts.
- Run every targeted verification command assigned to this review and record the
  real output.
- Audit for SHORTCUTS: stubs, TODOs, hard-coded values, partial wiring.
- Audit BEHAVIORAL REACHABILITY: schema accepts all 3 plan ids; publicPlanSchema
  parses max; tests prove both directions where relevant.
- Audit NAMED AUTHORITIES: pro's actual values used for 4× math and webhooks.
- Audit TEST INTEGRITY: new tests meaningful; no existing test modified.
- Audit ACCEPTED ARTIFACT COMPATIBILITY: plans.free/pro values byte-identical
  except additive flags; index.ts byte-identical; consumers listed.
- Audit IMPACT: grep consumers of planList/publicPlanSchema/planIdSchema.
- Audit REUSE: no duplicated plan definitions.
- Audit ARCHITECTURE and CONVENTIONS: house style preserved.
- Audit VERIFICATION COVERAGE: shared suite + typecheck + lint correct classes.
- Audit SCOPE using content diff/hashes: only the 2 declared paths.
- For every major finding, append a `finding` entry to the major log before
  finishing.

Report — write `review-1.md` with exactly one unambiguous marker on its own line:
`VERDICT: PASS` or `VERDICT: FAIL`. An optional Markdown heading may precede it.
If FAIL, provide a numbered list of concrete, actionable findings: file and
location, what is wrong, why it matters, and exactly what to change. PASS means
zero unresolved task-relevant findings and real verification evidence. In the
Decision Packet, mark `FAST-PATH ELIGIBLE: YES` only when the review is independent,
required verification is complete, scope/preservation evidence is clean, and no
conflict requires orchestrator investigation. Put pre-existing unrelated defects
in the defect ledger rather than failing the task solely for them.

End your reply with the verdict and review path.
