# packages/shared — AGENTS.md

Single source of truth for contracts shared between the webapp, the workers
and the MCP server: zod schemas, enums, the check catalog and scoring types.
**Nothing platform-specific lives here** — no React, no Next.js, no DB, no
BullMQ.

## What lives here

| File (planned/existing) | Contents |
|---|---|
| `src/plans.ts` | Pricing plans, limits, credit rules (`annualPriceCents` = display-only jaarprijs, plan 16) |
| `src/billing.ts` | Billing-contracten (plan 16): invoice-view, subscription-view (betaalmethode), checkout `{planId, interval}`, subscription-update |
| `src/scan-progress.ts` | `scanCategorySchema`, `categoryProgressSchema`, `progressDetailsSchema`, `scanProgressEventSchema` (plan 06) |
| `src/scan-progress-math.ts` | Pure progress-math (plan 27): `initialProgressDetails` (catalog-totalen), `advanceProgressDetails` (queue-modus: `current_check` = zojuist voltooide check), `overallProgress`, `summarizeFindings`, `checksForCategoryInOrder` |
| `src/check-catalog.ts` | Check catalog entries (`id`, `category`, `name`, `active`), `categoryLabels`, `queueCategories`/`checksForQueue` (queue-owner per categorie, plan 27) |
| `src/findings.ts` | Versioned findings schema (severity, status, category, remediation), `findingId`, severity-helpers, carry-over + checks→findings mapper (plan 09); finding-state `regressed` + `snooze_until` (plan 59) |
| `src/diff.ts` | Plan 59 diff-monitoring: pure SHA-256 (`sha256hex`), finding-fingerprint (rule-only), `isSnoozed`/`isCleanScan`, `scanDiffSchema` (`new/resolved/regressed/unchanged` per severity + `new_finding_ids`/`regressed_finding_ids`/`alert_*`), `computeScanDiff`, `emptyScanDiff`, `diffHasChanges`, `countAtOrAbove`, `scanDiffResponseSchema` |
| `src/scoring.ts` | Category scores (`categoryScoresSchema`) + `categoryScoresFromFindings` (pass-ratio per categorie) + `overallScoreFromFindings` (plan 08/27) |
| `src/report.ts` | Export-contract (plan 10): `reportFormatSchema`, `reportDataSchema`, `reportMetaSchema`, `reportListResponseSchema`, `reportListQuerySchema` |
| `src/fix-prompt.ts` | AI fix-prompts (plan 60): `fixPromptSchema` (`{prompt, findings_covered, truncated}`), `fixPromptTemplates` per check-id + fallback, `buildFindingFixPrompt`/`buildScanFixPrompt` (grouping per bestand/route, ~1500-token-truncatie), `findingLocation`/`extractFilePath`, `estimateTokens` |
| `src/crux.ts` | Plan 62 CrUX field data: `cruxMetricSchema`/`cruxDataSchema`/`cruxEvidenceSchema`/`cruxDivergenceEvidenceSchema`, `computeCruxDivergences` (drempels: LCP > 1s, INP > 200ms, CLS > 0,1), `CRUX_VITAL_LABELS` |
| `src/reputation.ts` | Plan 75 threat intelligence: `reputationSchema`/evidence, vijf bronstatussen en pure `classifyReputation`-severity |
| `src/index.ts` | Re-exports |

## Rules

- Every API boundary in the webapp and every worker↔DB write validates with a
  schema from here — **never duplicate schemas in `apps/*`**.
- Findings schema is **versioned**: bump the version field on breaking
  changes; stored as JSONB by `packages/db`.
- Check catalog is the contract for the whole product: the UI renders it
  (progress lists), the workers implement it (see
  [apps/worker/AGENTS.md](../apps/worker/AGENTS.md)). Adding a check = a
  catalog entry + a worker implementation — both must land in the same PR.
- Keep this package dependency-free (zod only) so all apps can import it.

## Adding a check (recipe)

1. Add entry to `check-catalog.ts` with a unique `id` + `category`.
2. Unit-test id uniqueness.
3. Implement the check in `apps/worker/src/checks/` (per
   [apps/worker/AGENTS.md](../apps/worker/AGENTS.md)).

## Commands

```bash
pnpm --filter shared typecheck
pnpm --filter shared test
```
