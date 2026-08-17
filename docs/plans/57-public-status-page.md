# Plan: Publieke statuspagina (uptime-badge + 30/90-dagen-geschiedenis)

**Doel**: Een publiek deelbare statuspagina per site, zonder login: live status-badge, uptime-% (30/90 dagen), incidenten (down/recovery uit `uptime_events`) en een client-side grafiek. Deelbaar als `status.site.nl`-achtige URL (CheckVibe: "public status page with 90-day history your customers can check").

**Status**: ✅ Klaar (2026-08-17).

## Besluiten (bevestigd 2026-08-16)

1. **Eigen Next.js-route** `(public)/status/[slug]/page.tsx` in de bestaande webapp — geen aparte deploy, geen subdomein-vereiste
2. **Slug**: willekeurig gegenereerd (12+ tekens, `crypto.randomUUID`-derivaat), opt-in per site via "Publiek maken"-toggle; `sites.public_status_slug` is nullable/uniek
3. **Alleen uptime-data publiek**: status, uptime-%, incidenten, grafiek — **geen findings, geen scores, geen site-internals**; pagina `noindex`
4. **Grafiek client-side SVG** (30/90 dagen, balk per dag: up/down/geen-data) — geen chart-library nodig
5. **JSON-feed**: `GET /api/public/status/[slug]` retourneert dezelfde data als JSON (voor eigen hosting/badges) — met Redis-rate limiting (plan 26) en kleine payload
6. Data uit bestaande tabellen (`uptime_events`, `sites`); alleen read-only queries, geen nieuwe publieke tabellen
7. **Besloten bij bouw**: de JSON-feed en de SSR-pagina bevatten ook `series` (dagbalken voor het gevraagde venster) — nodig voor de client-side grafiek; `uptime_30d`/`uptime_90d` zijn altijd beide aanwezig
8. **Besloten bij bouw**: rate limit faalt open (pagina blijft werken als Redis even down is); onbekende/niet-hex slug → 404 zonder existence-leak; schema stript onbekende keys (defense-in-depth tegen interne lekkage)

## Uitgangssituatie (code vandaag)

- Uptime-dashboard (11) in Fase 4: status per site, metrics, 30/90-dagen-geschiedenis (grafiek) — de publieke pagina hergebruikt dezelfde data-builder
- `uptime_events` (status, latency, timestamp) bestaat uit feature 50/24; `sites` (plan 04)
- Nog geen slug-veld, geen publieke route

## Contract / DB / API

- Migratie: `sites.public_status_slug text null unique`
- `PATCH /api/sites/[id]` (plan 04) accepteert `public_status: { enabled: bool }` → slug genereren/verwijderen; slug zelf wordt alleen in de respons en UI getoond (geen listing)
- `GET /api/public/status/[slug]` → `{ site_host, status, uptime_30d, uptime_90d, incidents: [{start, end, error_class}] }` (zod in shared)
- `(public)/status/[slug]/page.tsx`: SSR-basisstatus + client-side grafiek

## Stappen

1. Migratie + shared schema's (`publicStatusSchema`) + slug-helper (crypto, tests)
2. PATCH-route-uitbreiding + toggle-UI op de site-detailpagina (delen-knop, copy-URL)
3. Data-builder `getPublicStatus(slug)` — hergebruik uit dashboard-data (11)
4. Publieke pagina: badge, uptime-%, SVG-grafiek 30/90, incidentenlijst; noindex-meta
5. JSON-route + rate limiting + cache-headers
6. Tests: slug-generatie/uniekheid, authz (toggle eigenaar-only), geen findings in publieke data, noindex, rate limit

## Open vragen

- ~~Per-site of per-team-statuspagina (een team met 10 sites → 10 pagina's of 1 overzicht?)~~ — eerst per-site (eenvoudig), team-overzicht later (v2)
- ~~Custom subdomein (status.jouw.site)~~ — v2 via nginx-config per klant, of helemaal niet (deelbare `scanpal.app/status/[slug]`-URL volstaat)
- ~~SSR-caching~~ — pagina is `force-dynamic` (read-only, geen cache); JSON-feed met `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`

## Acceptatiecriteria

- [x] Publieke pagina toont status, uptime-%, 30/90-dagen-grafiek en incidenten zonder login
- [x] Toggle + deel-URL werken; slug is niet raadbaar en niet geïndexeerd
- [x] Publieke data bevat nooit findings/scores/PII; JSON-feed werkt met rate limiting
- [x] Alleen teamleden kunnen de toggle aanpassen; pagina bestaat alleen voor actieve slugs (404 anders)
