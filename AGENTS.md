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
│  queues: scan.dispatcher · scan.http · scan.browser ·    │
│          scan.github · uptime.check                      │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│  WORKERS  (separate Node processes, Dockerized)          │
│  http-worker    browser-worker    github-worker          │
│  probes, crawl  Playwright: CWV,  Semgrep/Gitleaks/      │
│  headers, sec   axe, AEO-render   OSV (containers)       │
└───────────────┬─────────────────────────────────────────┘
                ▼
   PostgreSQL (JSONB findings) · Redis (queue/cache/locks)
```

**Core rule**: the webapp only creates jobs; it never performs scans inline.
The worker is a second process in Docker Compose. Communication is only via
queue + database.

## Directory structure

```
apps/
  web/                # Next.js — frontend + REST API routes
    app/
      (auth)/         # login, register, reset
      (dashboard)/    # dashboard, sites, scans, findings, reports, billing, settings
      api/            # REST routes (see Features)
    lib/              # server helpers, auth, billing, db clients
  worker/             # BullMQ worker processes
    src/queues/       # dispatcher, http, browser, github, uptime
    src/checks/       # individual checks per queue
    src/aggregate/    # score + ranking of findings
    Dockerfile
packages/
  mcp-server/         # MCP wrapper over REST API (run_scan, get_findings, ...)
  db/                 # schema, migrations, types
  shared/             # shared types, zod schemas, check catalog, enums
docker-compose.yml
```

## Scan pipeline

1. `POST /api/scans` → webapp validates URL, creates `sites` + `scans` rows, enqueues `scan.dispatcher` job, responds `202` immediately.
2. Dispatcher fans out: one `scan.http` job, one `scan.browser` job, and (if GitHub repo detected / requested) one `scan.github` job.
3. Workers run their checks concurrently (per-host concurrency limit + politeness delay). Each check writes a `checks` row and findings to the scan's `findings` JSONB; scan `progress` is updated per completed check.
4. Dispatcher finish handler aggregates: computes overall + per-category score, ranks findings (critical → info), marks scan `completed`/`failed`, triggers notifications.
5. Webapp polls `GET /api/scans/{id}` (or SSE) until `completed`, then renders results.

## Key invariants

- Checks are isolated and idempotent; a scan can be re-run.
- Per-host concurrency limit and rate limiting (Redis) — never hammer the target.
- Findings schema is versioned in `packages/shared` (zod), stored as JSONB.
- Uptime poller runs every 60s with Redis locks; alert only after 2 consecutive failures.
- No secrets in code or logs. API keys via env/secret manager only.

## Data model (core tables)

`users` · `teams` · `memberships` · `sites` · `scans` (status, progress, scores) ·
`findings` (JSONB) · `checks` · `uptime_events` · `threat_alerts` · `api_keys` ·
`subscriptions` · `notifications`

## Commands

```bash
pnpm install
docker compose up -d        # postgres + redis + queue + workers
pnpm dev                    # webapp (http://localhost:3000)
pnpm --filter worker dev    # worker
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
