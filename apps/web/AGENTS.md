# apps/web — AGENTS.md

Next.js (App Router) webapp: **frontend + REST API routes in one app**. The
webapp only creates scan jobs and reads results — it never runs scans inline.

See the [root AGENTS.md](../AGENTS.md) for the overall architecture; this file
covers the webapp layer only.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  BROWSER                                              │
│  (auth) pages · (dashboard) pages · EventSource(SSE)  │
└──────────────────────┬───────────────────────────────┘
                       │ fetch / forms
┌──────────────────────▼───────────────────────────────┐
│  NEXT.JS (App Router, server components + routes)     │
│  app/api/*            → REST routes (see table)       │
│  app/(dashboard)/*    → pages                         │
│  lib/                 → server-only helpers           │
└──────┬────────────────────────────┬───────────────────┘
       │ enqueue (BullMQ, 202)      │ read/write (pg pool)
       ▼                            ▼
  QUEUE (scan.*)              POSTGRES + REDIS
```

**Core rule (root)**: `POST /api/scans` → validate, create rows, enqueue
`scan.dispatcher`, respond `202`. Never await a scan.

## Key contracts

- **Auth & teams**: sessions per plan 01; roles `owner`/`member` per plan 02.
  Every site/scan query is scoped via the membership join — non-member → 404.
- **API-auth (plan 14)**: alle data-routes (`sites*`, `scans*`, `findings`,
  `uptime*`) accepteren óf een Supabase-sessie óf `Authorization: Bearer
  sp_live_…` via `lib/api-auth.ts` → `requireTeam(request)` → `teamId`.
  Keys zijn team-scoped; de DB slaat alleen `sha256(key)` op; revoked/expired
  → 401. Rate limiting (Redis fixed-window, `lib/rate-limit.ts`) per key én
  per team (plan-limiet `apiRatePerMinute`) → 429 + `Retry-After`;
  usage-tracking in `api_key_usage` (last_used_at per request).
  Uitgezonderd: `auth/*`, `webhooks/*`, `billing/checkout|portal` en de SSE
  stream (GET-only zonder headers). `api/api-keys*` is sessie + owner-only.
- **Credits**: plan 03 — spend credits atomically when creating a scan;
  plan limits gate features (e.g. scheduled scans on Pro).
- **Scan progress (plan 06)**: `GET /api/scans/[id]/stream` is DB-driven SSE
  (2s poll of the scans row, heartbeat `:ping` every 15s, terminal event
  closes the stream, ~5 min max). Client falls back to polling
  `GET /api/scans/[id]` every 3s. Progress payloads come from
  `packages/shared` (`scan-progress.ts`, `check-catalog.ts`).
- **Progress writer**: `lib/scan-progress.ts` re-exports the shared math
  (`packages/shared`) and the writers from `packages/scan-core`
  (`updateScanProgress` + atomic `advanceCategoryProgress`) — one source of
  truth for web and workers (plan 27, besluit 3/4).
- **Enqueue (plan 27, besluit 7)**: `lib/scan-queue.ts` → `enqueueScan(scanId)`
  adds `scan.dispatcher` with `jobId = scanId` (lazy Redis singleton). Routes
  always respond `202`; no `SCAN_MODE` fallback, no inline probe.

## Route map (feature refs point to docs/FEATURES.md)

| Route | Feature | Notes |
|---|---|---|
| `api/auth/*` | 17 | sessions, oauth, magic link, roles |
| `api/onboarding/sites` | 1, 4 | first scan in the onboarding flow |
| `api/sites*` | 18 | CRUD, URL normalization, duplicate check, GitHub-repo detect (site-detail GET sinds plan 63 — `get_site` MCP-tool) |
| `api/sites/[id]/schedule` | 5, 18 | daily/weekly schema (09:00 UTC, `next_scan_at`), Pro-gate → 403 + upsell |
| `api/scans` + `api/scans/[id]` | 19 | create (202 + enqueue `scan.dispatcher`), get (progress/result — incl. `crux` field data, plan 62), list, cancel |
| `api/scans/[id]/stream` | 6 | SSE progress (contract in plan 06) |
| `api/scans/[id]/findings` + `api/scans/[id]/findings/[findingId]` | 20 | GET lijst: filter (severity/category/status/q/route_url, server-side) + counts; GET detail (plan 63 — `get_finding` MCP-tool); PATCH: status/note per finding (plan 09) én `snooze_until` (plan 59: 7/30d of `"next-scan"`, snooze-only verandert de status niet) |
| `api/scans/[id]/findings/[findingId]/prompt` | 60 | GET: één copy-paste AI fix-prompt voor één finding (`fixPromptSchema`); authz als de scans-routes; onbekende finding → 404 |
| `api/scans/[id]/fix-prompt` | 60 | GET: één gegroepeerde fix-prompt voor alle niet-fixed/ignored findings (per bestand/route, ~1500 tokens, `truncated` + `findings_covered`); authz als de scans-routes |
| `api/scans/[id]/diff` | 59 | GET: diff t.o.v. de laatste schone snapshot + geselecteerde findings (nieuw + teruggekeerd); authz als de scans-routes; lege diff voor oude scans |
| `api/reports/[scanId]` + `api/reports` + `api/reports/[scanId]/content` | 9, 21 | export (plan 10): generate PDF (react-pdf) + Markdown per scan (`?format=md\|pdf`, alleen `completed` → anders 409 + status, `X-Report-Id`-header), historie-lijst (filter `site_id`, team-scoped, max 100), opgeslagen download (geen regeneratie); elke download legt een `reports`-rij vast; sessie óf API-key; `?include_prompts=1` neemt per finding een AI fix-prompt mee (plan 60) |
| `api/billing*`, `api/webhooks/stripe` | 22 | checkout now; plan-sync after MVP |
| `api/billing/invoices` + `api/billing/subscription` | 16 | facturen live uit de Stripe-API (geen lokale tabel); abonnement-view (DB + 1 live call), PATCH/DELETE owner-only (opzeggen = `cancel_at_period_end`), checkout-body `{ planId, interval }`; `invoice.payment_failed` → hub-notificatie `payment_failed` (dedup per invoice) |
| `api/notifications` + `api/notifications/[id]/read` + `api/notifications/read-all` + `api/notifications/preferences` | 13, 23 | notificatiehub (plan 13): per-user lijst (unread/type-filters, paginated), read/read-all, voorkeuren-toggles; bel-badge in de dashboard-layout |
| `api/uptime*` | 24 | status per site, metrics |
| `h/[token]` | 12 | publieke honeypot-decoy: altijd 404 + no-index, hit-logging + inline analyse async (`after()`); bypass in `proxy.ts` |
| `api/threats` + `api/threats/events` | 12 | Pro-gated: overzicht per site + gefilterde events (403 + upsell op Free) |
| `api/sites/[id]/honeypot` | 12 | Pro-gated: honeypot aan/uit + token-rotatie, retourneert install-snippet |
| `api/api-keys*` | 25 | bearer keys (`sp_live_`, plan 14): GET/POST lijst+create (full key 1×), DELETE soft-revoke; owner-only → 403 |
| `api/webhooks` + `api/webhooks/[id]` + `[id]/secret` + `[id]/test` + `[id]/deliveries` | 15, 23 | outbound webhooks (plan 15): lijst/create (secret 1×), PATCH/DELETE, rotate (owner-only), test-delivery (event `test`), delivery-log; teamlid-sessie, géén bearer keys |
| `api/webhooks/github` + `api/webhooks/vercel` | 58 | on-deploy triggers (plan 58): inbound, publiek, HMAC-verified (`x-hub-signature-256` met per-site secret / `x-vercel-signature` met env-secret); match repo/url → scan `trigger='deploy'` (202 `{ scans: [...] }`, 200 stil bij geen match, 401 ongeldig, cooldown 10 min/site via Redis) |
| `api/sites/[id]/deploy-webhook` | 58 | webhook-setup (plan 58): genereert/roteert `sites.github_webhook_secret` (AES-GCM, owner-only), retourneert URL + secret 1× |
| `api/sites/[id]/ownership` + `verify-ownership` + `ownership-token-rotations` | 76 | DNS TXT-eigendomsverificatie: lazy token, live apex-check, 5 verify-pogingen/min/site, rotatie wist de oude verificatie; team/workspace-scoped |

## Rules & conventions

- TypeScript strict; **zod validation on every API boundary** (schemas live in
  `packages/shared`, not duplicated here).
- RESTful routes under `app/api/`, status codes per plan/contract:
  `202` for scan create, `401`/`404` for authz failures (do not leak
  existence), `400` for validation.
- `lib/` files are server-only (import `server-only`); never ship DB pools or
  secrets to the client.
- EventSource is GET-only — SSE routes must not require headers.
- SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache,
  no-transform`, `X-Accel-Buffering: no` (nginx on the VPS).
- New endpoint = route + shared schema + authz + tests (vitest in this app).

## Commands

```bash
pnpm --filter web dev      # http://localhost:3000
pnpm --filter web lint
pnpm --filter web test     # vitest
pnpm --filter web typecheck
```

For tests a local user is available via `scripts/create-test-user.mjs`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
