# Out-of-Scope Defects — Run 20260818T110500Z-opencode-7f2d

_Defect ledger for unrelated pre-existing defects found during work._

## OSD-001 — Cosmetic: JSDoc in `packages/shared/src/report-tokens.ts` says "16 bytes entropie"
- Found by: phase-1 auditor (MFL-20260818-009). The v4-UUID-derived generator yields 122 bits (two fixed nibbles), not 16 bytes/128 bits.
- Impact: none (cosmetic doc comment; token still brute-force-proof).
- Disposition: queue for phase-6 sweep (small doc fix, not worth a separate task).

## OSD-002 — `sites-manager.tsx` stores whole response into `{plan,error}`-typed upsell state
- Found by: task-D implementer + confirmed by task-D reviewer.
- Detail: `apps/web/components/sites-manager.tsx:~172` does `setUpsell(data)` where `Upsell = {plan,error}`,
  but the route payload is `{ error, upsell: { plan, feature } }` — so reading `upsell.plan` there is
  `undefined` at runtime (works only because `data` is `any`). Pre-existing, unrelated to plan-64.
- Impact: the sites upsell modal's upgrade button may POST `planId: undefined` (falls back to "pro" via
  `upsell?.plan ?? "pro"` at the call site, so likely masked today). Low, pre-existing.
- Disposition: out of scope for plan 64; task-D's team-settings.tsx does NOT copy the bug. Queue for a
  future sites-manager fix (not phase-6 of this plan unless trivially bundled).
