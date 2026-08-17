# deploy — AGENTS.md

Deployment for ScanPal: Docker Compose on a VPS behind nginx. Directory does
not exist yet — this file is the blueprint (infra is staged in Fase 0/3 of
docs/ROADMAP.md; `docker-compose.yml` exists at the repo root).

## Architecture

```
                        INTERNET
                           │ 443
                      ┌────▼────┐
                      │  nginx  │  TLS termination, SSE: proxy_buffering off,
                      │  (VPS)  │  X-Accel-Buffering: no for /api/scans/*/stream
                      └────┬────┘
                           │ 127.0.0.1
              ┌────────────▼───────────────┐
              │  compose network (bridge)  │
              │  web (Next.js)             │
              │  worker (BullMQ)           │
              │    ├─ http-worker          │
              │    ├─ browser-worker       │  (Playwright image)
              │    └─ github-worker        │  (docker-in-docker for semgrep/
              │                            │   gitleaks/osv containers)
              │  postgres · redis          │
              └────────────────────────────┘
```

## Services (docker-compose.yml)

| Service | Image | Notes |
|---|---|---|
| `web` | `scanpal/web` | Next.js; `restart: unless-stopped` |
| `worker` | `scanpal/worker` | BullMQ workers; separate process, never inline |
| `uptime-poller` | `scanpal/worker` | zelfde image als worker, entrypoint `uptime:start` (plan 11); Redis-locks per site, maintenancelock |
| `postgres` | `postgres:16` | volume for data, no public port |
| `redis` | `redis:7` | queue/cache/locks; persistence on |
| `browser-worker` / `github-worker` (later) | Playwright / dind | Fase 3 |

## Environment & secrets

- Everything config via environment (`.env` at repo root, gitignored); never
  commit secrets. Env vars include: `DATABASE_URL`, `REDIS_URL`,
  `NEXTAUTH_URL`/Supabase keys, `STRIPE_*`, `RESEND_API_KEY`,
  `GITHUB_TOKEN`, `APP_URL`.
- The webapp must not expose `DATABASE_URL` to the client bundle.
- Backups: nightly `pg_dump` of postgres volume; test restore procedure
  before trusting it.

## nginx specifics

- SSE must not be buffered: `proxy_buffering off;` +
  `proxy_cache off;` and the webapp sends `X-Accel-Buffering: no`.
- `client_max_body_size` limited (uploads are not an MVP feature).
- TLS: certbot/Let's Encrypt, auto-renewal in cron.
- Security headers on the nginx layer for the marketing/auth pages; scan
  results pages are behind auth anyway.

## Operations

```bash
docker compose up -d --build     # deploy
docker compose logs -f web worker
docker compose exec postgres pg_dump -U scanpal scanpal > backup.sql
```

## Rules

- Reproduce prod locally with the same compose file (`docker compose up -d`).
- Workers scale independently: `docker compose up -d --scale worker=N`.
- Readiness: web waits for postgres/redis (healthchecks); worker connects
  lazily so it can boot before the queue exists.
