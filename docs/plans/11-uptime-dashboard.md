# Plan: Uptime-dashboard (status per site, 60s-metrics, 30/90-dagen grafiek)

**Doel**: Elke site elke 60s proberen, status + latency bijhouden, en een dashboard tonen met per site de actuele status, uptime-percentages (24u/30d) en een 30/90-dagen geschiedenisgrafiek. Vertical slice: worker (50) + API-routes (24) + dashboard-UI (11).

**Status**: Klaar (2026-08-16).

## Besluiten (bevestigd 2026-08-15)

1. **Scope**: één plan dekt de hele slice — feature 50 (poller), 24 (routes), 11 (dashboard). De 2-failure alert-regel hoort hierbij (status-transitie); e-mail/webhook-notificaties volgen in plan 13 (Fase 5).
2. **Monitoring aan bij alle sites** (default `true`), geen plan-gating en geen credits voor probes; per-site toggle is in v1 mee. Als infra-kosten later omhoog gaan → cap in v2.
3. **Probe**: GET op de canonieke URL (plan 04) met `https://`-prefix, timeout 10s, max 5 redirects. `< 500` = up; `>= 500`, DNS/TLS-fout of timeout = down. Bij connect/TLS-fout op https → één http-fallback-poging; het resultaat van de beste poging telt (latency = snelste geslaagde poging).
4. **Status-transitie** (invariant uit AGENTS.md): down na **2 opeenvolgende failures**, up na **1 geslaagde probe**. `sites.uptime_state` + `uptime_state_changed_at` worden bij transitie gezet.
5. **Retentie**: raw events **30 dagen**; dagen 31–90 via dag-aggregaat (`uptime_daily`). Maintenance-job (elke 6u, Redis-lock) doet eerst de rollup van complete dagen, daarna events ouder dan 30 dagen verwijderen — idempotent.
6. **Lock**: Redis-lock per site (`uptime:lock:{site_id}`, SET NX EX 15) zodat meerdere poller-instances nooit dezelfde site tegelijk pollen; lock altijd releasen.
7. **Poller als eigen loop** in `apps/worker/src/uptime/` (plain interval, zoals `apps/scheduler` uit plan 05) — geen afhankelijkheid van de BullMQ-pipeline (Fase 3). Zodra die er is: verhuizen naar de `uptime.check`-queue. Graceful shutdown: loop stoppen, lopende probe afronden, lock releasen.
8. **Grafiek zonder nieuwe dependency**: eigen lichte SVG-componenten (`components/uptime/`) voor sparkline + 30/90-grafiek; vervangbaar door een chart-lib in v2.
9. **Migratie-nummer**: `007_uptime.sql` — `005` is door plan 06 geclaimd (nog niet op disk), `006` bestaat. Nummering bij merge afstemmen.

## Uitgangssituatie (code vandaag)

- `sites.uptime_state` bestaat al (migratie `006_sites.sql`, default `'unknown'`, check up/down/unknown) en zit in `siteWithStatusSchema` (`packages/shared/src/sites.ts`)
- Geen `uptime_events`-tabel, geen poller, geen `api/uptime*`-routes, geen uptime-pagina
- `apps/worker` is nog blueprint (Fase 3); de poller start als eigen proces met eigen entrypoint
- Features 13 (notificaties) en 51 (MCP `get_uptime`) zijn aparte plannen; de contracten hieronder moeten die kunnen verbruiken

## DB (migratie `007_uptime.sql` in `packages/db`)

Nieuwe tabel `uptime_events`:

- `id uuid pk default gen_random_uuid()`
- `site_id uuid not null references sites(id) on delete cascade`
- `checked_at timestamptz not null default now()`
- `status text not null check (status in ('up','down'))`
- `latency_ms int` (nullable — null bij down zonder response)
- `status_code int` (nullable)
- `error text` (nullable — korte reden: timeout/dns/tls/http-5xx)
- index `(site_id, checked_at desc)` — de grafiek-query is team-scoped via `sites`

Nieuwe tabel `uptime_daily` (dag-aggregaat, dagen 31–90):

- `site_id uuid not null references sites(id) on delete cascade`
- `day date not null`
- `checks int not null default 0` · `failures int not null default 0`
- `avg_latency_ms numeric` (nullable) · `p95_latency_ms numeric` (nullable)
- `primary key (site_id, day)`

Uitbreiden `sites`:

- `uptime_state_changed_at timestamptz` (nullable) — "down sinds"-weergave
- `uptime_enabled boolean not null default true` — monitoring-toggle

> Rollback ter referentie in de migratie (geen down-migraties in deze repo).

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/uptime` | GET | ingelogd | Per team-site: `uptime_state`, `uptime_state_changed_at`, `uptime_24h_pct`, `uptime_30d_pct`, `avg_latency_ms_24h` |
| `/api/uptime/sites/[id]` | GET | ingelogd | Detail: summary + serie voor de grafiek (`?days=30\|90`) + laatste 20 events; 30d → uurbuckets uit `uptime_events`, 90d → dagbuckets uit `uptime_daily` |
| `/api/uptime/sites/[id]` | PATCH | ingelogd | Monitoring aan/uit (`{ enabled: boolean }`); zet `uptime_enabled` |

Authz: alle queries team-scoped via de membership-join (plan 02); vreemde `site_id` → `404` (geen lek). De GET-endpoints leveren ook het contract voor MCP-tool `get_uptime` (plan 51).

Uptime% = percentage van de checks in het venster (24u/30d uit events; 90d alleen in de grafiek). p95 via `percentile_cont` over het venster.

## packages/shared (nieuw `src/uptime.ts`)

- `uptimeEventSchema` — `{ id, site_id, checked_at, status: 'up'|'down', latency_ms, status_code, error }`
- `uptimeSummarySchema` — `{ site_id, url, label, uptime_state, uptime_state_changed_at, uptime_24h_pct, uptime_30d_pct, avg_latency_ms_24h }`
- `uptimeSeriesPointSchema` — `{ at, up_pct, avg_latency_ms }`
- `uptimeDetailSchema` — `summary + series + recent_events`
- `uptimeHistoryQuerySchema` — `{ days: 30|90 }`
- `updateUptimeMonitoringSchema` — `{ enabled: boolean }`
- exports in `src/index.ts`

## Worker: poller (`apps/worker/src/uptime/`)

- `probe.ts` — GET-probe (https + http-fallback), timeout 10s, latency + status + code + error; per-host politeness (globale concurrency-limiet ~10)
- `state.ts` — transities: 2e opeenvolgende failure → down (+ `uptime_state_changed_at`); 1e succes na down → up; eerste probe ooit → up/down. Puur getest (unit)
- `uptime-poller.ts` — entrypoint: elke 60s alle `uptime_enabled` sites ophalen, per site Redis-lock (EX 15) → probe → event schrijven → state-update; graceful shutdown
- `maintenance.ts` — elke 6u (eigen loop): rollup complete dagen → `uptime_daily` (INSERT … ON CONFLICT DO UPDATE), daarna events ouder dan 30 dagen verwijderen; idempotent, Redis-lock tegen overlap
- docker-compose: extra proces `uptime-poller` (zodra de worker-container van Fase 3 er is: zelfde image, ander entrypoint)

## UI (`(dashboard)/`)

- Nav-link "Uptime"; `uptime/page.tsx` (server + client-gedeelte): per site een rij — status-dot (up groen / down rood / unknown grijs), hostname, uptime% 24u/30d, gem. latency, sparkline (24u, uurbuckets), "Down sinds …" bij down; toggle monitoring; auto-refresh elke 30s tijdens actief scherm
- `uptime/[siteId]/page.tsx`: 30/90-dagen grafiek (toggle-knoppen), metrics-rij (uptime%, avg/p95 latency, laatste incident), laatste events-lijst
- Componenten: `components/uptime/status-dot.tsx`, `sparkline.tsx`, `uptime-chart.tsx` (eigen SVG); empty state ("Nog geen sites…")
- Sites-pagina (plan 04) toont `uptime_state` al — die wordt hier echt gevuld, geen wijziging nodig

## Stappen

1. Migratie `007_uptime.sql` + shared schema's (`src/uptime.ts`) + exports
2. `probe.ts` + `state.ts` met unit-tests (transities, 2-failure-regel, recovery, http-fallback)
3. `uptime-poller.ts` (loop, locks, concurrency, graceful shutdown) + docker-compose-proces
4. `maintenance.ts` (rollup + cleanup, idempotentie getest)
5. `GET /api/uptime` + `GET /api/uptime/sites/[id]` (authz, bucket-aggregatie in SQL) + `PATCH`-toggle; route-tests (authz, bucketing 30/90, uptime%-berekening)
6. UI: overzicht + detail + grafiek + auto-refresh + nav; tests voor de status-berekening in de UI-laag
7. Contract-check voor plan 51 (`get_uptime` verbruikt `GET /api/uptime`)

## Open vragen

- ~~Plan-gating / credits voor monitoring?~~ → opgelost: geen gating, geen credits (v1)
- ~~Lock: Redis of DB `for update skip locked`?~~ → opgelost: Redis-lock (AGENTS.md-invariant)
- ~~Telt 5xx als down?~~ → opgelost: ja (`>= 500` down)
- ~~Herstel na 1 succes of na 2?~~ → opgelost: na 1 succes
- ~~Grafiek-bibliotheek?~~ → opgelost: eigen SVG-component, geen nieuwe dependency
- ~~Retentie aanpak 31–90 dagen?~~ → opgelost: dag-aggregaat + rollup vóór cleanup
- Nieuw: moet de uptime-kolom op de sites-pagina (plan 04) naar de uptime-pagina linken? (klein; met plan 04-mee regelen)

## Acceptatiecriteria

- [x] Elke site met monitoring aan wordt elke 60s (± drift) geprobeerd; nooit twee probes voor dezelfde site tegelijk (lock geldt ook bij meerdere poller-instances)
- [x] Elke probe legt een `uptime_events`-rij vast (status, latency, status_code); na 2 opeenvolgende failures → `down` + "down sinds"; na 1 succes → terug `up`
- [x] Uptime-dashboard toont per site: status, uptime% 24u/30d, gem. latency, sparkline; 30/90-dagen-grafiek met toggle werkt
- [x] Overzicht ververst zichzelf (≤30s); down-site toont de duur van de storing
- [x] Alleen teamleden zien hun eigen sites (vreemde `site_id` → 404); toggle werkt per site
- [x] Maintenance draait idempotent: complete dagen gerolluped naar `uptime_daily`, events ouder dan 30 dagen verwijderd; 90d-grafiek blijft kloppen
- [x] Poller stopt netjes bij shutdown (lopende probe af, lock released)
- [x] `GET /api/uptime` is bruikbaar voor MCP-tool `get_uptime` (plan 51)
