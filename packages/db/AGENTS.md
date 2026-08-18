# packages/db — AGENTS.md

PostgreSQL schema, migrations and types for the whole monorepo. The only
place where `CREATE TABLE` / `ALTER TABLE` happens.

## Data model (core tables)

```
users ─┬─ memberships ─ teams
       └─ api_keys ──────────┘(team-scoped)
sites ── scans ── findings (JSONB) ── checks
        └──── uptime_events ─────────┘
threat_honeypots/events/rules (v2) · subscriptions (stripe) · notifications ·
webhooks ── webhook_deliveries (outbox) · reports (opgeslagen exports, plan 10)
```

| Table | Purpose | Notes |
|---|---|---|
| `users`, `teams`, `memberships` | accounts + roles (owner/member) | invite flow per plan 02 |
| `sites` | URLs, normalized, GitHub repo info | `last_scan_*` denormalized (plan 04) |
| `scans` | status, `progress` int, `progress_details` JSONB, scores, `diff` JSONB (plan 59) | `progress_details` contract in plan 06; `diff` contract in `packages/shared/src/diff.ts` |
| `findings` | JSONB, versioned schema from `packages/shared` | never ad-hoc columns |
| `checks` | one row per check run | isolated, idempotent |
| `uptime_events` | probes + latency | 2-failure alert rule |
| `threat_honeypots`, `threat_events`, `threat_rules` | honeypot + patroon-detectie (plan 12) | 1 honeypot per site, events team-scoped, seeded rules |
| `subscriptions` | stripe plan sync | + `cancel_at_period_end`, `interval` (month/year, plan 16); webhook-sync live |
| `webhooks` | outbound webhook endpoints per team | events ⊆ notificatie-types; secret encrypted (AES-GCM, key in env) |
| `webhook_deliveries` | outbox-rijen (notify → deliverer) | unieke `dedup_key`, statuses pending/ok/failed/rejected/disabled (plan 15) |

## Migration conventions

- One file per change in `migrations/`, monotonic `NNN_name.sql`
  (e.g. `001_users_teams_memberships.sql`). Next free number must be checked
  before writing — plans claim numbers in advance (plan 05 → `004`, plan 06 →
  `005`); align on merge.
- Migrations are run with `pnpm db:migrate` (see `src/migrate.ts`); never
  change an applied migration — add a new one.
- JSONB for findings/progress; `timestamptz` for times; UUIDs + FK constraints
  on every relation; index every column used in team-scoped queries
  (`team_id`, `site_id`, `status`, `created_at`).

## Rules

- App code must not write ad-hoc SQL outside this package's types/migrations.
- Types exported from `src/index.ts` are the compile-time contract; runtime
  shapes are validated with `packages/shared` zod schemas.
- No secrets in migrations or seeds.
- RLS (migratie 024): tabellen met team-data hebben RLS + select-policies
  volgens de app-laag-regels (teamleden lezen team-data, alleen de eigen
  users-rij, api_keys/api_key_usage default-deny). De app-pool-rol
  (BYPASSRLS) is niet geraakt; RLS is de grens voor niet-bypassende rollen
  (PostgREST/anon). Gebruik `public.is_team_member`/`is_team_owner`
  (security definer) in nieuwe policies — nooit direct op memberships
  subquery-en in een policy (recursie).

## Commands

```bash
pnpm db:migrate             # from repo root
docker compose up -d postgres redis
pnpm --filter db typecheck
```
