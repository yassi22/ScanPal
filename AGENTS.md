# ScanPal — AGENTS.md

Website security & SEO scanner. Enter a URL → 100+ parallel checks in ~60s →
ranked findings with severity, remediation, and exportable reports. Inspired by
CheckVibe, including GitHub repo scans, uptime monitoring, and an MCP server.

## Stack

- **Monorepo**: pnpm workspaces
- **Webapp**: Next.js (App Router) + TypeScript — frontend + REST API routes in one app
- **Workers**: separate Node process(es), BullMQ + Redis for job queues
- **Storage**: PostgreSQL (users, sites, scans, findings as JSONB), Redis (queue, cache, rate-limit, locks)
- **Browser checks**: Playwright (Dockerized worker)
- **GitHub checks**: Semgrep (SAST), Gitleaks (secrets), OSV-Scanner (deps) — run as containers
- **Auth**: Supabase Auth (or Auth.js)
- **Billing**: Stripe · **Email**: Resend
- **MCP server**: `@modelcontextprotocol/sdk`, wrapper over the REST API
- **Deploy**: Docker Compose on a VPS

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND + API  (Next.js webapp)                        │
│  Dashboard · sites · scan results · billing · settings   │
│  app/api/* · auth · webhooks (stripe, resend)            │
└───────────────┬─────────────────────────────────────────┘
                │ enqueue job, never waits for the scan
                ▼
┌─────────────────────────────────────────────────────────┐
│  QUEUE  (BullMQ over Redis)                              │
│  queues: scan.dispatcher · scan.aggregate ·              │
│          scan.http · scan.browser · scan.github ·        │
│          uptime.check                                   │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│  WORKERS  (separate Node processes, Dockerized)          │
│  http-worker    browser-worker    github-worker          │
│  probes, crawl  Playwright: CWV,  Semgrep/Gitleaks/      │
│  headers, sec   axe, AEO-render   OSV (containers)       │
│  dispatcher + aggregator (scan.aggregate)                │
└───────────────┬─────────────────────────────────────────┘
                ▼
   PostgreSQL (JSONB findings, checks-tabel) · Redis (queue/cache/locks)
```

**Core rule**: the webapp only creates jobs; it never performs scans inline.
The worker is a second process in Docker Compose. Communication is only via
queue + database.

## Agent navigation (AGENTS.md map)

Read the AGENTS.md of the directory you work in; this file is the index.

| File | Scope |
|---|---|
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | Next.js frontend + REST API routes: route table, auth/roles, credit enforcement, SSE contract, enqueue-only scan start |
| [`apps/worker/AGENTS.md`](apps/worker/AGENTS.md) | BullMQ workers: dispatcher fan-out, check catalog, aggregator/scoring, retry/timeout, Redis locks, checks-tabel, uptime poller |
| [`packages/scan-core/AGENTS.md`](packages/scan-core/AGENTS.md) | Shared scan-lifecycle DB-helpers (web + worker): finishScan, setSiteScanState, atomic progress, credits, notifications, dispatcher-enqueue |
| [`packages/shared/AGENTS.md`](packages/shared/AGENTS.md) | Single source of truth: check catalog, zod schemas (progress, findings, events), enums, scoring types, pure progress-math |
| [`packages/db/AGENTS.md`](packages/db/AGENTS.md) | Migrations, tables, JSONB requirements, indexes |
| [`packages/notify/AGENTS.md`](packages/notify/AGENTS.md) | Notificatiehub (plan 13): notify() → voorkeuren, dedup, in-app rijen + Resend-mail |
| [`packages/mcp-server/AGENTS.md`](packages/mcp-server/AGENTS.md) | MCP tools (run_scan, get_scan, get_findings, list_sites, get_uptime) — wrapper over the REST API |
| [`docs/AGENTS.md`](docs/AGENTS.md) | Documentation conventions: FEATURES.md / ROADMAP.md / docs/plans numbering and status flow |
| [`deploy/AGENTS.md`](deploy/AGENTS.md) | Docker Compose, VPS + nginx, env vars, secrets, backups |

Rule of thumb: **change code in the smallest directory whose AGENTS.md covers
the feature.** Cross-cutting changes (new check, new endpoint, scan-lifecycle
change) touch at least the owner dir + `packages/shared` (contract) and often
`packages/scan-core` (DB-helpers).

## Directory structure

```
apps/
  web/                # Next.js — frontend + REST API routes
    app/
      (auth)/         # login, register, reset
      (dashboard)/    # dashboard, sites, scans, findings, reports, billing, settings
      api/            # REST routes (see Features)
    lib/              # server helpers, auth, billing, db clients, scan-queue enqueue
  worker/             # BullMQ-pipeline-consumers + uptime-poller (Fase 3 ✅)
    src/queues/       # dispatcher, aggregate, http, browser, github (+ DLQ, boot)
    src/checks/       # individual checks per queue (http: reachability, https,
                      #   security-headers, meta-tags, secrets-in-bundles, active-tests)
    src/uptime/       # uptime-poller (60s-probe, locks, maintenance) — live
    Dockerfile
  scheduler/          # DB-gedreven scheduler (plan 05): pollt elke 60s due sites,
                      #   enqueuett scan.dispatcher (geen inline probe meer)
    src/              # core (poll-logica), credits, env
packages/
  mcp-server/         # MCP wrapper over REST API (run_scan, get_scan, ...)
  db/                 # schema, migrations, types
  scan-core/          # scan-lifecycle DB-helpers gedeeld door web + worker + scheduler
  shared/             # shared types, zod schemas, check catalog, enums, pure progress-math
  notify/             # notificatiehub (plan 13): in-app rijen + Resend-mail, dedup
docker-compose.yml
```

## Scan pipeline

1. `POST /api/scans` (of onboarding/scheduler) → webapp validates URL, creates `sites` + `scans` rows, enqueues `scan.dispatcher` (`jobId = scanId`) via `packages/scan-core`, responds `202` immediately.
2. Dispatcher resolves scan+site, writes the progress skeleton (progress 0), and fans out via FlowProducer: parent job on `scan.aggregate`, children `scan.http` + `scan.browser` (+ `scan.github` if the site has a `github_repo`).
3. Workers run their catalog checks (per-host concurrency limit + rate limit). Each check writes a `checks` row (idempotent upsert) and advances progress atomically (`advanceCategoryProgress`, `select … for update`).
4. When all children complete, the `scan.aggregate` job runs: it builds the final `findings` payload from the `checks` rows, computes overall + per-category scores (`scans.category_scores`), calls `finishScan` (race-guard: `canceled` is never overwritten), and emits notifications (scan_done / critical_finding / scan_diff — plan 59; the old score_drop mail is superseded by the diff-based alert). Partial failure after exhausted attempts → the whole scan ends `failed` + DLQ.
5. Webapp polls `GET /api/scans/{id}` (or SSE) until `completed`, then renders results.

## Key invariants

- Checks are isolated and idempotent; a scan can be re-run.
- Per-host concurrency limit and rate limiting (Redis) — never hammer the target.
- Findings schema is versioned in `packages/shared` (zod), stored as JSONB.
- Uptime poller runs every 60s with Redis locks; alert only after 2 consecutive failures.
- No secrets in code or logs. API keys via env/secret manager only.

## Data model (core tables)

`users` · `teams` · `memberships` · `sites` · `scans` (status, progress, scores, `crux` JSONB — plan 62) ·
`findings` (JSONB) · `checks` · `uptime_events` · `threat_honeypots`/`threat_events`/`threat_rules` ·
`api_keys` · `subscriptions` · `notifications` · `webhooks`/`webhook_deliveries` (outbound, plan 15)

## Commands

```bash
pnpm install
docker compose up -d        # postgres + redis + scheduler + uptime-poller + worker
pnpm dev                    # webapp (http://localhost:3000)
pnpm worker:dev             # pipeline-workers (dispatcher/aggregate/http/browser/github)
pnpm scheduler:dev          # geplande scans (plan 05; enqueuett scan.dispatcher)
pnpm lint
pnpm typecheck
pnpm test
```

## Conventions

- TypeScript strict. Zod validation on every API boundary.
- API routes: RESTful, versioned under `app/api/`, status codes per contract.
- No comments unless requested. Match existing code style.
- Database changes go through `packages/db` migrations.
- New check = add catalog entry in `packages/shared` + implementation in `apps/worker/src/checks/`.
