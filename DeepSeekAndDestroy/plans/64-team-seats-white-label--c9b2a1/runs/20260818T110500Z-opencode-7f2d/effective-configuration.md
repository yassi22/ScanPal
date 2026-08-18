# Effective Configuration — Run 20260818T110500Z-opencode-7f2d

## PROFILE CHANGE 2026-08-18 (user instruction: "gebruik sonnet 5 en jij zelf als director")
Run id retains its `-opencode-` slug for continuity, but the effective orchestrator
and worker profile changed at resume. See MFL-20260818-014.

## Orchestrator (current)
- Harness: Claude Code (Opus 4.8) — the director. Reads plan/authority/state, routes,
  decides, approves phase gates. Writes only orchestration state; never edits project source/tests.
- Checkpoint mode: harness-native context management; HANDOVER.md kept current incrementally.
- Python launcher: `python` (3.12.0), not `python3`/`py`. Project toolchain: `pnpm` (tests green in prior tasks).

## Worker profile (all roles) — current
- Mechanism: Claude `Agent` tool, `subagent_type: general-purpose`, `model: sonnet` (Sonnet 5).
- Each `Agent` call = a fresh cold worker context (satisfies fresh-implementer / different-fresh-reviewer).
- Repair: `SendMessage` to the reviewer agent's id/name to resume it with its judgment context intact.
- Prompts must be fully self-contained (subagents do not see the orchestrator conversation): embed
  unit spec, decided answers (MFL-010), exact paths, scope rules, verification commands, and the
  report destination path under the task dir.
- Execution: sequential. One reviewable unit per worker.
- Budgets: 5 substantive review rounds; transport failures (subagent launch/crash) handled separately.

## Prior worker profile (superseded, kept for provenance)
- OpenCode CLI (`opencode run`), model `opencode-go/deepseek-v4-flash`, ephemeral OPENCODE_DB per worker.
- Used for: phase-1 (all), phase-2 discovery + task A + task B. Those artifacts remain valid/accepted.

## Policy notes
- Live/destructive/paid verification: requires explicit authorization (not expected this run).
- No code edits by orchestrator; workers only.
