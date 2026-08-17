# packages/scan-core — AGENTS.md

Shared scan-lifecycle DB helpers imported by the webapp, the worker pipeline
and the scheduler (plan 27, besluit 3): **one source of truth** for how a scan
moves through the pipeline (queued → running → completed/failed/canceled).
The webapp re-exports these (`apps/web/lib/{scans-core,credits,finding-status,
sites-core,scan-progress}.ts`) so routes stay thin.

**Rule**: worker ↔ DB writes for the scan lifecycle go through this package —
never duplicate the SQL in `apps/*`. Pure math lives in `packages/shared`
(zod-only, no DB); this package is the DB-owning layer.

## What lives here

| File | Contents |
|---|---|
| `src/types.ts` | `ScanRowWithMeta`, `ScanError`, `FinishScanInput` (shared web + worker types) |
| `src/progress.ts` | `updateScanProgress` (simple) + `advanceCategoryProgress` (atomic, `select … for update`) + `writeProgressSkeleton` (dispatcher) |
| `src/finish-scan.ts` | `setSiteScanState` (site-status-cache) + `finishScan` (finaliseert completed/failed, race-guard op `canceled`, schrijft `category_scores` + `scans.diff`) |
| `src/scan-diff.ts` | Plan 59: `findCleanSnapshot` (laatste schone scan van de site) + `computeAndWriteScanDiff` (diff-berekening binnen de finish-transactie, `regressed`-flags + `"next-scan"`-snooze-sentinels verbruiken) |
| `src/build-findings.ts` | `buildFindingsFromChecks` — `checks`-rijen → versioned findings-payload (plan 27, besluit 5) |
| `src/finding-status.ts` | `carryOverFindingStatuses` — fixed/ignored overnemen uit de vorige scan (plan 09) |
| `src/notifications.ts` | `emitScanFinishedNotifications` — scan_done / critical_finding via `packages/notify` (send injected) |
| `src/credits.ts` | `spendCredit` / `refundCredit` / plan-gating (subscription state) |
| `src/queue.ts` | `createScanDispatcherQueue(redisUrl)` + `enqueueScanDispatcher(queue, scanId)` (`jobId = scanId`) |

## Pipeline contract (plan 27)

- Webapp/scheduler enqueuen `scan.dispatcher` (`jobId = scanId`) en antwoorden
  `202` — nooit inline.
- Workers schrijven per check een idempotente `checks`-rij en atomair progress
  (`advanceCategoryProgress`); de aggregator bouwt findings uit `checks` en
  roept `finishScan` (race-guard: `canceled` wordt nooit overschreven).
- `finishScan` schrijft `scans.category_scores` (contract uit
  `packages/shared` scoring.ts) en werkt `sites.last_scan_*` bij.

## Commands

```bash
pnpm --filter scan-core typecheck
pnpm --filter scan-core test
```