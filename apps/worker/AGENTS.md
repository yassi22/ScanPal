# apps/worker — AGENTS.md

BullMQ worker processes (separate Node processes, Dockerized). Consumers of
the `scan.*` queues; the only place where scans are actually performed. The
scan pipeline (plan 27, feature 27 ✅) is live; the uptime poller
(`src/uptime/`, plan 11 ✅) still runs as its own loop and can move to the
`uptime.check` queue later without contract changes.

## Architecture

```
                       webapp/scheduler enqueues (202)
                             │
                             ▼
        ┌─────────────────────────────────────────────┐
        │  QUEUES (BullMQ over Redis)                  │
        │  scan.dispatcher → fan-out (FlowProducer)    │
        │    ├─ scan.http      (http + seo checks)     │
        │    ├─ scan.browser   (aeo — feature 41–43)   │
        │    └─ scan.github    (github — feature 46–49)│
        │  scan.aggregate      (parent job, draait als │
        │                       alle children klaar zijn)
        │  uptime.check       (later; vandaag eigen loop)
        └──────┬──────────────────────────┬───────────┘
               ▼                          ▼
   apps/worker/src/checks/          POSTGRES (scans, checks,
   per-check implementations        findings JSONB, category_scores)
        └───────────────►  REDIS: locks, rate-limit, retry-backoff
```

## Scan pipeline (detail)

1. `scan.dispatcher` job (`jobId = scanId`): resolve scan+site, write the
   `progress_details` skeleton (progress 0) and create a FlowProducer flow —
   parent job on `scan.aggregate`, children `scan.http` + `scan.browser` +
   (`scan.github` only when `sites.github_repo` is set). Job-names are
   idempotent (`{scanId}:{queue}`), so a re-run never duplicates.
2. Workers run their catalog checks (per-host concurrency limit + Redis rate
   limit — never hammer the target). Each check:
   - writes a `checks` row (idempotent upsert on `(scan_id, check_id)`),
   - advances progress atomically via `advanceCategoryProgress` from
     `packages/scan-core` (`select … for update` on the scans row).
3. When all children complete, the `scan.aggregate` job runs: it builds the
   final versioned `findings` payload from the `checks` rows
   (`buildFindingsFromChecks`, carry-over from plan 09), computes overall +
   per-category scores (`packages/shared` scoring) and calls `finishScan`
   (`completed`/`failed`, race-guard on `canceled`), updates
   `sites.last_scan_*`, and emits notifications (scan_done, critical_finding,
   score_drop).
4. Retry/timeout per queue (dispatcher: 1 · http: 3 · browser: 2 · github: 2 ·
   aggregate: 3) with backoff; after exhausted attempts the job is dead-lettered
   to `dlq.scan.*` and — for sub-jobs/aggregator — the whole scan is marked
   `failed` (partial-failure policy, plan 27 besluit 6).

## Check contract (important)

**New check = catalog entry in `packages/shared` + implementation in
`apps/worker/src/checks/`.** The catalog defines `id`, `category`, `name`;
the UI and progress layer render from the catalog. Never add a check that
only exists in the worker. Implementations return `InlineCheckLike[]` (the
same shape the old inline probe used) and the shared `inlineChecksToFindings`
mapper converts them to v1 findings.

Registry (`src/checks/registry.ts`): queue → implemented checks. The http
queue already runs reachability, https, security-headers, meta-tags,
secrets-in-bundles and the active-tests bundle (plan 52); browser/github
queues are empty until features 41–43 / 46–49. `skeletonTotals` computes the
progress totals per category (active-tests only when the scan flag is on).

## Uptime worker (feature 50)

- HTTP probe every 60s per site; **Redis lock per site** so only one poller
  runs it.
- Records latency + status into `uptime_events`; alert only after **2
  consecutive failures** (feature 24/13).
- State transitions fire `site_down` / `site_recovered` through the
  notification hub (`packages/notify`, plan 13): incident-id =
  `uptime_state_changed_at` (dedup: 1× per incident). Runs after the
  transaction, failures are logged, never break the poll.
- Graceful shutdown: stop taking jobs, finish current probe, release lock.

## Rules & conventions

- Jobs are isolated and idempotent — a scan can be re-run safely.
- Retry/timeout policy per queue; dead-letter after N attempts
  (`queuePolicies` in `src/queues/index.ts`).
- Findings schema is versioned in `packages/shared` (zod) — bump the version,
  never silently change the shape.
- Per-host concurrency + Redis rate limit are mandatory for every new check
  that makes outbound requests.
- Containers (semgrep, gitleaks, osv-scanner) are invoked via Docker with
  read-only mounts of the cloned repo; no secrets passed as args.
- No secrets in code or logs; tokens via env/secret manager only.
- Scan-lifecycle DB writes go through `packages/scan-core` — never duplicate
  the SQL in the worker.

## Commands

```bash
pnpm --filter worker dev     # run all scan-pipeline workers (dev)
pnpm --filter worker start   # pipeline workers (prod, tsx)
pnpm --filter worker uptime:start   # uptime-poller alleen
pnpm --filter worker test
pnpm --filter worker typecheck
# E2E (redis + pg + migraties lokaal): E2E=1 pnpm --filter worker test -- e2e
docker compose up -d         # includes worker containers
```