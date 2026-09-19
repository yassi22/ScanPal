# ScanPal

Checks websites for **security, SEO, performance, AI visibility and compliance** — and turns technical findings into clear, prioritised improvements.

🌐 Portfolio: [yassinc.nl](https://yassinc.nl/)

---

## Overview

ScanPal audits a website across five dimensions — security, SEO, performance, AI visibility and compliance — and translates raw technical findings into a single health score with actionable, prioritised improvements. Enter a URL and background workers run the full check catalogue in parallel, typically completing in about a minute.

It runs live in production behind accounts and paid plans; this repository is published as an open **case study** of the architecture and engineering behind it.

## Architecture

```
Browser → Next.js → BullMQ / Redis → Workers → PostgreSQL → Dashboard
```

A scan is **queued, not held open**: the API validates the request and responds immediately, while background workers do the heavy lifting and stream results back to the dashboard.

| Layer | Technology |
|---|---|
| **Monorepo** | pnpm workspaces, TypeScript 5, Node 20 |
| **Web app** | Next.js 16 (App Router), React 19, Tailwind 4 — dashboard, pages and REST API in one app |
| **Queue** | BullMQ 6 + Redis 7 distribute scans across background workers |
| **Workers** | Playwright, axe-core, Semgrep, Gitleaks, OSV-Scanner — browser behaviour, accessibility, code and secrets |
| **Database** | PostgreSQL 16 — sites, scans, checks, findings (JSONB), teams |
| **Auth & payments** | Supabase Auth (magic links) + Stripe (Pro / Max plans) |
| **AI integration** | Model Context Protocol (MCP) server lets AI tools start and read scans |
| **Quality & infra** | Vitest, ESLint, Docker Compose |

The web app never scans inline — it only creates jobs. Workers run as separate Node processes, and all communication happens over the queue and the database. See [AGENTS.md](AGENTS.md) for the full architecture map.

## How a scan runs

1. **Start & checks** — the API validates team access, input, subscription and scan credits.
2. **Instant response** — a scan record is created, a single job is dropped in Redis, and the API answers with `HTTP 202`. No minute-long open request.
3. **Split investigation** — a crawler discovers routes, then work fans out across three workers:
   - **HTTP** — headers, TLS, DNS, SEO
   - **Browser** — Playwright, accessibility (axe-core), Core Web Vitals
   - **GitHub** — Semgrep (SAST), Gitleaks (secrets), OSV-Scanner (dependencies)
4. **Idempotent results** — each check writes an idempotent row to PostgreSQL, so any job can be retried safely.
5. **Score & dashboard** — an aggregator builds the findings, computes overall and per-category scores, and diffs against earlier scans. The dashboard streams updates live via Server-Sent Events, with polling as a fallback.

The check catalogue holds **80 unique check IDs**; because checks repeat per discovered route, a single scan runs well over a hundred checks in practice.

## Project layout

```
apps/
  web/         # Next.js — frontend + REST API routes
  worker/      # BullMQ pipeline consumers + uptime poller
  scheduler/   # DB-driven scheduler for recurring scans
packages/
  shared/      # check catalogue, zod schemas, enums, scoring types
  scan-core/   # scan-lifecycle DB helpers shared across apps
  db/          # schema, migrations, types
  notify/      # notification hub (in-app + email)
  mcp-server/  # MCP wrapper over the REST API
docs/          # features, roadmap and per-feature plans
```

Each layer keeps its own `AGENTS.md` next to the code — start from the root [AGENTS.md](AGENTS.md) and drill down.

## Tech stack

`TypeScript` · `Next.js` · `React` · `PostgreSQL` · `BullMQ` · `Redis` · `Playwright` · `Semgrep` · `Gitleaks` · `Supabase Auth` · `Stripe` · `Docker`

## Running locally

```bash
pnpm install
cp apps/web/.env.example apps/web/.env   # fill in your own keys
docker compose up -d                     # postgres + redis + scheduler + uptime-poller + worker
pnpm dev                                 # web app → http://localhost:3000
pnpm worker:dev                          # pipeline workers
pnpm scheduler:dev                       # scheduled scans
```

Useful checks: `pnpm lint` · `pnpm typecheck` · `pnpm test`.

All configuration is documented in [`apps/web/.env.example`](apps/web/.env.example). No secrets ship in this repository — Supabase, Stripe and Resend keys are supplied entirely through your own environment.

## A note on the code

ScanPal runs live in production, behind an account and a paid plan. This repository is shared as a **case study** of the product and its architecture. I'm happy to give a short walkthrough — reach out via [yassinc.nl](https://yassinc.nl/).
