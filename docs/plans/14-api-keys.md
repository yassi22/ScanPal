# Plan: Profiel + API-keys (bearer) voor API/MCP

**Doel**: Profielpagina + API-key beheer (feature 14), bearer-key auth op alle API-routes + MCP-serverkoppeling (feature 25 + 51), met rate-limiting en usage-tracking (deel van feature 26 naar voren).

**Status**: ✅ klaar

## Besluiten (bevestigd 2026-08-16)

- **Statische bearer keys** met prefix `sp_live_` (32 random bytes, base64url). Full key wordt **1×** getoond bij creatie; DB slaat alleen `sha256(key)` op. Vervangt het HMAC-idee uit AGENTS.md — de auth-mode blijft swappable in één helper (`lib/api-auth.ts`), zodat HMAC later als uitbreiding kan.
- **Alleen de team-owner** mag keys aanmaken/revoken; **team-scoped** (één key = heel team, conform mcp-server AGENTS.md). Members → 403.
- **Sessie-of-key** op alle bestaande `/api/*` routes, behalve: `api/auth/*` (eigen flow), `api/webhooks/*` (Stripe-signature), `api/billing/checkout|portal` (sessie-redirects) en `api/scans/[id]/stream` (EventSource is GET-only zonder headers — MCP-clients pollen `GET /api/scans/[id]`).
- **Rate limiting + usage-tracker in dit plan**: Redis fixed-window per key + per team, daily counters in DB (`api_key_usage`). Limieten per plan-tier (03) indien beschikbaar, anders default 120 req/min.
- Migratie **`008_api_keys.sql`** claimen (volgende vrije nummer; 001–007 bestaan).

## Uitgangssituatie (code vandaag)

- Geen `api_keys`-tabel of code; routes zijn sessie-only via `lib/supabase/server` + `proxy.ts`-guard.
- `api/scans*`, `api/sites*`, `api/scans/[id]/findings*`, `api/uptime*`, `api/reports*` bestaan en gebruiken team-scoping (membership-join, non-member → 404).
- MCP-server: blueprint bestaat (`packages/mcp-server/AGENTS.md`), nog geen code. Settings-UI-patroon staat in `(dashboard)/settings/team`.

## Contract / DB / API

**Migratie 008**: `api_keys` (id, team_id FK, created_by FK, name, prefix, key_hash unique, last_used_at, revoked_at, expires_at, created_at) + `api_key_usage` (key_id, day, request_count, PK(key_id, day)) + indexes op team_id/key_hash.

**packages/shared** (`api-keys.ts`): zod-schema's `createApiKeySchema`, `apiKeyViewSchema` (zonder hash), `apiKeyCreatedSchema` (view + full key).

**Nieuwe routes** (owner-only):

| Route | Methode | Beschrijving |
|---|---|---|
| `/api/api-keys` | GET | lijst (prefix, name, last_used_at, revoked_at) |
| `/api/api-keys` | POST | create `{name}` → full key 1× |
| `/api/api-keys/[id]` | DELETE | soft-revoke (`revoked_at`) |

**Auth-helper** `apps/web/lib/api-auth.ts`: `sha256(Bearer)` → lookup, check revoked/expired, `last_used_at` + usage-counter update (fire-and-forget), retourneert team_id → **zelfde team-scoping** als sessie (non-member → 404). Bestaande routes krijgen een `requireTeam(request)` dat óf sessie óf key accepteert. `lib/rate-limit.ts`: Redis INCR + EXPIRE (fixed window), 429 + `Retry-After`.

## Stappen

1. Migratie 008 + db-types (`packages/db`)
2. Zod-schema's in `packages/shared`
3. `lib/api-keys-core.ts` (generatie, hashing, create/list/revoke) + `lib/api-auth.ts` + `lib/rate-limit.ts`
4. Bestaande routes ombouwen naar sessie-of-key (scans, sites, findings, uptime, reports; stream/billing/webhooks/auth uitgezonderd)
5. Routes `/api/api-keys*` (owner-gate → 403)
6. UI: `(dashboard)/settings/profile` (naam/avatar via Supabase user_metadata) + `(dashboard)/settings/api-keys` (create/show-once-copy/list/revoke) + settings-navigatie
7. MCP-server: `Authorization: Bearer` header, key via `SCANPAL_API_KEY` env, README-voorbeeld (curl + MCP-config)
8. Tests (vitest): hashing/generatie, auth-helper (key vs sessie, revoked/expired, scoping), rate-limit, owner-only, api-keys-routes, MCP-smoke; lint + typecheck
9. FEATURES.md (14 + 25 → `14-api-keys`, 📝) + ROADMAP.md plan-overzicht bijwerken

## Open vragen

- ~~HMAC of bearer?~~ → bearer (bevestigd 2026-08-16). ~~Key-scope?~~ → owner/team (bevestigd 2026-08-16). ~~Rate-limiting hier of in 26?~~ → hier (bevestigd 2026-08-16).
- ~~Plan-tier limieten hardcoded of uit `plans`-tabel (03)?~~ → uit `plans` in `packages/shared` (free 60/min, pro 120/min), default 120 (bevestigd 2026-08-16).
- ~~Rename (PATCH) van keys nodig?~~ → nee, revoke + create volstaat (bevestigd 2026-08-16).
- ~~Usage-dashboard-UI al in settings?~~ → nee, alleen data (`api_key_usage`-tabel) voor later plan 26; UI toont alleen prefix/last-used/revoked (bevestigd 2026-08-16).

## Acceptatiecriteria

- [x] Owner maakt key → full key 1× zichtbaar, prefix in lijst; members krijgen 403
- [x] `Authorization: Bearer sp_...` werkt op sites/scans/findings/uptime met team-scoping (reports volgen met plan 10, bestaat nog niet)
- [x] Revoked/expired key → 401; boven limiet → 429 + Retry-After; usage per key/dag geteld, `last_used_at` geüpdatet
- [x] MCP-tools (run_scan, get_scan, get_findings, list_sites, get_uptime) werken met één key via env
- [x] Tests, lint en typecheck groen
