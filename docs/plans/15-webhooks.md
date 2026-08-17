# Plan: Outbound webhooks (JSON, HMAC-gesigneerd)

**Doel**: Feature 15 (webhooks instellen, outbound, JSON payload) + de outbound-webhook-kant van feature 23: teams configureren eigen endpoints die bij elke notificatie-event een JSON-payload krijgen — HMAC-gesigneerd, met retry/backoff, delivery-log, test-knop en SSRF-guard.

**Status**: ✅ klaar (2026-08-16)

## Besluiten (bevestigd 2026-08-16)

1. **Webhooks = derde kanaal van de notificatiehub** (`packages/notify`). De hub is de enige plek die events verstuurt (plan 13); `notify()` schrijft naast in-app-rijen en e-mail ook outbox-rijen (`webhook_deliveries`) voor elke enabled webhook van het team die dit event-type selecteert. Bezorging is **async** — de hub doet zelf geen HTTP-calls in de scan-flow.
2. **Outbox-patroon**: `notify()` schrijft deliveries met status `pending`; een **deliverer** verstuurt ze. Pre-BullMQ draait de deliverer als loop in de scheduler (bestaat al als los proces, pattern plan 05/11); na Fase 3 → BullMQ-queue `webhook.deliver`. Het contract (outbox-tabel) verandert daarbij niet.
3. **Event-types = de 7 notificatie-types** (scan_done, score_drop, site_down, site_recovered, critical_finding, credit_skip, scan_failed) + `webhook_disabled` als **nieuw notificatie-type** (melding als een webhook na 5 mislukte deliveries automatisch uit gaat). Per webhook checkbox-selectie. Verificatie van de provider is inbound (plan 22/58) en raakt dit plan niet.
4. **Signing**: HMAC-SHA256 over de raw body met een per-webhook secret (32 random bytes, base64url). Headers: `x-scanpal-signature` (`sha256=...`), `x-scanpal-timestamp` (anti-replay, 5-min-venster), `x-scanpal-event`, `x-scanpal-delivery` (delivery-id). Secret wordt **1×** getoond bij create; encrypted at rest (AES-GCM, zelfde pattern als `sites.github_webhook_secret` in plan 58).
5. **Retry**: max 5 pogingen, backoff 1m/5m/30m/2h tussen pogingen, per-poging timeout 10s; daarna webhook automatisch `disabled` + `webhook_disabled`-notificatie. Bepaalde 4xx (400, 401, 403, 404, 410) en ongeldige URLs zijn blijvend → geen retry (`rejected`).
6. **SSRF-guard**: bij create én bij delivery (DNS-resolutie-check) weigert de deliverer loopback/private-URLs: localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fd00::/8, 0.0.0.0. Dev: `http://localhost` alleen als `NODE_ENV !== "production"`.
7. **Dedup**: unieke `dedup_key` per (webhook_id, event, entityId, incidentId) — dubbele events/retries leveren nooit dubbele deliveries.
8. **Payload**: envelope `{ version: 1, id, event, created_at, team_id, data }` — `data` = de notify-payload, door de deliverer verrijkt met site/scan-context (site_id, site_url, scan_id, score) uit de DB waar beschikbaar. Zod-schema in `packages/shared/webhooks.ts`.
9. **UI**: `(dashboard)/settings/webhooks` — lijst (naam, URL, events, status, last delivery), create (secret 1× + copy), test-knop (event `test`), delivery-log per webhook (status, http_status, attempts, next_attempt_at), enable/disable/delete, secret-rotatie (owner-only).
10. Migratie **`011_webhooks.sql`** (008 = plan 14, 009/010 bestaan).

## Uitgangssituatie (code vandaag)

- `packages/notify` (plan 13 ✅): `notify()` → in-app rijen + Resend-e-mail, dedup via unieke `dedup_key`; **geen webhook-kanaal**. Type-schema's in `packages/shared/notifications.ts` (7 types).
- Geen `webhooks`-tabel of code. `app/api/webhooks/` bestaat alleen als **inbound** `webhooks/stripe/route.ts` (Stripe-signature, plan 22); GitHub/Vercel inbound volgen in plan 58. Static segment `stripe` wint in Next.js van `[id]` → outbound-management routes kunnen veilig onder `app/api/webhooks/` (zie Contract).
- Scheduler en uptime-poller draaien als losse processen met db + Redis (pattern voor de deliverer-loop); BullMQ (Fase 3) is er nog niet.
- Settings-UI-patroon: `(dashboard)/settings/{team,notifications}` bestaan, `api-keys` gepland (14).

## Contract / DB / API

**Migratie 011**:
- `webhooks` (id, team_id FK, created_by FK, name, url, secret_encrypted, events text[] check ⊆ event-types, active bool default true, failure_count int default 0, last_delivery_at, last_http_status, created_at, updated_at) + index (team_id)
- `webhook_deliveries` (id, webhook_id FK, event, payload JSONB, status `pending|ok|failed|rejected|disabled`, http_status, error, attempts int, next_attempt_at, dedup_key unique, created_at, delivered_at) + indexes (status, next_attempt_at), (webhook_id, created_at desc)

**packages/shared** (`webhooks.ts`): `webhookEventTypeSchema` (7 notificatie-types + `test`), `webhookCreateSchema`, `webhookUpdateSchema`, `webhookViewSchema` (zonder secret), `webhookCreatedSchema` (view + full secret, 1×), `webhookDeliveryViewSchema`, `webhookEnvelopeSchema` (outbound payload v1). `notifications.ts`: type `webhook_disabled` toevoegen (default enabled, template "Webhook uitgeschakeld").

**packages/notify**:
- `notify()` extra stap: enabled webhooks van het team met dit event ophalen → outbox-insert met `dedup_key` (buiten de transactie van de caller, zelfde regel als plan 13).
- `createWebhookDeliverer(deps)`: pollt due `pending|failed`-rijen, resolvet de URL, SSRF-guard, HMAC-sign, POST (timeout 10s), status-update + `last_delivery_*`, retry-scheduling, disable-na-5x + `notify({ type: "webhook_disabled", ... })`.

**API-routes** (`apps/web`, settings & admin):

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/webhooks` | GET | teamlid | lijst (zonder secret) |
| `/api/webhooks` | POST | teamlid | create `{name, url, events}` → secret 1× |
| `/api/webhooks/[id]` | PATCH | teamlid | update (name, url, events, active) |
| `/api/webhooks/[id]` | DELETE | teamlid | verwijderen + deliveries |
| `/api/webhooks/[id]/secret` | POST | owner | rotate (oud secret ongeldig, nieuw 1×) |
| `/api/webhooks/[id]/test` | POST | teamlid | test-delivery (event `test`, direct) |
| `/api/webhooks/[id]/deliveries` | GET | teamlid | delivery-log, paginated |

**Architectuur (outbound-draad in de pipeline):**

```
 scan-complete / site-down / score-drop / ...
        │  notify({ type, teamId, entityId, incidentId, payload })
        ▼
 ┌────────────────── packages/notify (hub) ──────────────────┐
 │ notify() → 1) in-app rijen (notifications)                │
 │             2) e-mail (Resend)                            │
 │             3) outbox-rijen (webhook_deliveries, pending) │
 └────────────────────────┬─────────────────────────────────┘
                          │ pending (async)
                          ▼
 ┌────── DELIVERER (scheduler-loop; na Fase 3: BullMQ queue webhook.deliver) ─────┐
 │ poll due → SSRF-guard → HMAC-sign + headers → POST (10s timeout)              │
 │ ok → status=ok · 4xx/ongeldig → rejected · fail → retry 1m..8h (max 5)        │
 │ 5× fail → webhook disabled + notify(webhook_disabled)                         │
 └────────────────────────┬─────────────────────────────────┘
                          ▼
                   klant-endpoint (HTTPS)
```

De pipeline zelf (dispatcher-finish-handler in Fase 3, webapp-scan-flow vandaag) verandert niet: webhooks lopen automatisch mee omdat `notify()` de events al kent. `notifications`-voorkeuren (per-user) zijn bewust **niet** van invloed op webhook-delivery — webhooks zijn team-breed.

## Stappen

1. Migratie 011 + db-types + shared zod-schema's (`webhooks.ts`, `webhook_disabled` in `notifications.ts`) + tests
2. `packages/notify`: webhook-kanaal in `notify()` (outbox-insert, dedup) + `createWebhookDeliverer` (signing, retry/backoff, SSRF-guard, disable-rule, envelope-verrijking) + tests
3. Scheduler: deliverer-loop starten (pre-BullMQ, pattern uptime-poller); BullMQ-swap als TODO voor Fase 3
4. API-routes + tests (authz team-scoping, owner-only rotate, SSRF-blocklist, create/update/delete)
5. UI: `(dashboard)/settings/webhooks` + navigatie (lijst, create-flow met secret-once, test, log, toggle/delete, rotate)
6. Tests (vitest): HMAC-timing-safe-vergelijking, retry/backoff-schema, disable-na-5-failures, dedup bij dubbele events, SSRF-blocklist + DNS-redirect-escape, envelope-zod, outbox→delivery end-to-end; lint + typecheck
7. FEATURES.md (15 + 23 → `15-webhooks`, 📝) + ROADMAP.md plan-overzicht bijwerken

## Open vragen (beantwoord 2026-08-16)

- ~~Beheer-rechten: alle teamleden of owner-only (parallel aan plan 14 — voorstel: members beheren, secret-rotatie owner)?~~ → **Members beheren (team-scoped), secret-rotatie owner-only** — parallel aan plan 14.
- ~~Event-namespace: notificatie-types hergebruiken (voorstel) of eigen webhook-names (`scan.completed`, `site.down`)?~~ → **Notificatie-types hergebruiken** (team-breed, niet gekoppeld aan per-user voorkeuren); `test` alleen als delivery-event.
- ~~Payload-verrijking: welke context standaard mee (site_id, site_url, scan_id, score — findings-samenvatting wel/niet)?~~ → **site_id, site_url, scan_id, score** waar beschikbaar (alleen ontbrekende velden invullen); **geen findings-samenvatting** in v1.
- ~~Replay (herversturen van een delivery uit het log) in v1 of v2?~~ → **Niet in v1**.
- ~~Beperkingen: max webhooks per team (voorstel 3) en max payload (voorstel 256 KB) — koppelen aan plan 03/26?~~ → **free 1 / pro 3** (`maxWebhooks` in `plans.ts`), max payload **256 KB**; voor nu constante waarden, koppeling aan plans volgt met 03/26.

## Acceptatiecriteria

- [x] Webhook aanmaken → secret 1× zichtbaar; update/delete werken; rotatie owner-only; members team-scoped
- [x] Alle 8 event-types leveren gesigneerde JSON (HMAC-SHA256 + timestamp + event/delivery-headers) met envelope v1
- [x] Outbox + backoff-retries (1m..2h, max 5); 4xx/ongeldige URL = rejected (geen retry); 5× fail → webhook disabled + `webhook_disabled`-notificatie
- [x] SSRF-guard: loopback/private-URLs geweigerd bij create én bij delivery (incl. DNS-redirects)
- [x] Delivery-log per webhook (status, http_status, attempts, next_attempt_at); test-knop levert directe `test`-delivery
- [x] Dedup: max 1 delivery per event per webhook, ook bij retries/dubbele events
- [x] Tests, lint en typecheck groen
