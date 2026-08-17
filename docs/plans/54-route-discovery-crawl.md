# Plan: Route-discovery + per-route checks (SPA-aware crawl)

**Doel**: Een crawl-fase in de scan-pipeline die vóór de checks routes ontdekt — via sitemap.xml, robots.txt, intern link-crawl én SPA-heuristics (Next.js/Vite/Remix/SvelteKit routes uit JS-chunks/route-manifests, zoals CheckVibe's "up to 150 routes") — waarna de checks per ontdekte route draaien i.p.v. alleen op de homepage. Findings en scores worden route-bewust.

**Status**: Voltooid (2026-08-17).

> **Realisatie-verwijzingen**
> - Migratie: `packages/db/migrations/017_scan_routes.sql` (`scan_routes`, `scans.route_count`, `checks.route_url` + partial unique indexes).
> - Pure helpers + schema's: `packages/shared/src/routes.ts` (`routeSourceSchema`, `scanRouteSchema`, `routeLimitByPlan`, `CRAWL_LIMITS`, `PER_ROUTE_IMPL_IDS`, `normalizeRouteUrl`, `dedupeRoutes`, `extractInternalLinks`, `parseSitemap`, `parseRobotsTxt`, `isPathDisallowed`, `detectSpaFramework`, `extractSpaRoutes`, `topRouteUrls`); `findingSchema.route_url` + `inlineChecksToFindings(checks, now, routeUrl?)` in `packages/shared/src/findings.ts`.
> - DB-helpers: `packages/scan-core/src/routes.ts` (`upsertScanRoutes`, `getScanRoutes`, `setRouteHttpStatus`); `buildFindingsFromChecks` flattatt arrays (`packages/scan-core/src/build-findings.ts`).
> - Queue: `SCAN_CRAWL_QUEUE`/`createScanCrawlQueue`/`enqueueScanCrawl` in `packages/scan-core/src/queue.ts`.
> - Worker: `scan.crawl`-processor in `apps/worker/src/queues/crawl.ts`; dispatcher enqueues crawl i.p.v. flow (`apps/worker/src/queues/dispatcher.ts`); boot-registratie in `apps/worker/src/queues/boot.ts`; route-bewuste scan-worker in `apps/worker/src/queues/scan-worker.ts`; queue-policy in `apps/worker/src/queues/index.ts`.
> - API/UI: `route_count` + `routes[]` in `apps/web/app/api/scans/[id]/route.ts`; route-filter in `apps/web/lib/findings-core.ts`; `ScanViewState.routeCount` in `apps/web/lib/scan-progress-client.ts`; route-teller in `apps/web/components/scan-result.tsx`; route-dropdown + badge in `apps/web/components/findings-panel.tsx`; `apps/web/app/(dashboard)/scans/[id]/page.tsx`.
> - Tests: `packages/shared/src/__tests__/routes.test.ts`, `packages/shared/src/__tests__/findings.test.ts`, `apps/worker/src/queues/__tests__/{dispatcher,scan-worker,crawl}.test.ts`.
>
> **Openstaande keuzes**
> - `route-discovery` info-finding heeft géén catalog-entry in `check-catalog.ts`; `inlineChecksToFindings`/`checkById("route-discovery")` fallbackt naar category "http" (de crawler schrijft de rij met category "seo" direct). Eventueel later een catalog-entry toevoegen voor UI-correctheid.
> - CWV/axe worden (zoals voor plan 54) uitsluitend op top-routes gedraaid; de subset-keuze per route is via `PER_ROUTE_IMPL_IDS = {"security-headers","cookies","cors","meta-tags"}` (per route) vs homepage-only (reachability, https, secrets-in-bundles, active-tests).
> - Pre-existing, buiten plan 54: `apps/web/lib/__tests__/uptime-core.test.ts` faalt op een zod-schema-issue in uptime-code — niet aangeraakt door dit plan.

## Besluiten (bevestigd 2026-08-16)

1. **Nieuwe queue `scan.crawl`**: de dispatcher (27) start `scan.crawl` vóór de fan-out; de fan-out naar `scan.http`/`scan.browser`/`scan.github` volgt pas als de route-lijst klaar is (dispatcher heeft dus een dependency op crawl)
2. **Routes opslaan in eigen tabel `scan_routes`** (`scan_id`, `url` genormaliseerd, `source` = `sitemap|link|spa|seed`, `http_status` nullable) — geen JSONB; filterbaar in UI en querybaar
3. **Plan-limiet**: max routes via feature-flag `routes` (feature 3): Free 10, Pro 150 (waarde afstemmen); bij limiet stoppen met ontdekken en een info-finding "meer routes beschikbaar op Pro"
4. **Per-route check-subset**: volledige check-set op de homepage + top-N routes; op de rest een subset (security-headers, secrets-in-html, meta-tags, structured-data); CWV/axe alleen op top-routes (kosten)
5. **SPA-heuristics alleen bij SPA-signaal** (stackdetectie 40 of JS-chunk-patroon): route-manifests (Next.js `_next/static/chunks`-trail, Vite `assets`, Remix/SvelteKit), geen giswerk op willekeurige paths
6. **Politeness geldt ook voor crawl**: per-host concurrency + delay uit AGENTS.md; redirects volgen (max 3), query-params normaliseren, geen login-vereiste routes

## Uitgangssituatie (code vandaag)

- Mini-crawler (38) bestaat in MVP (SEO: interne links + broken links) — wordt de basis van de route-ontdekking
- Dispatcher-fan-out (27) en progress-model (plan 06) zijn Fase 3; de crawler-fase wijzigt de pipeline-volgorde (AGENTS.md scan-pipeline stap 2–3)
- Findings-schema versioned; per-check progress via `updateScanProgress`

## Contract / DB / API

- Migratie `scan_routes` + `scans.route_count` (denormaliseerd voor de lijst)
- `GET /api/scans/[id]` retourneert `routes: { url, source, http_status }[]` + `route_count`; resultatenpagina krijgt een route-filter
- Findings krijgen optioneel `route_url` (welke route de finding vond)
- `POST /api/scans` (plan 05): geen contractwijziging (routes volgen automatisch); plan-limiet zit in de crawl-job

## Stappen

1. Migratie `scan_routes` + shared schema's (`scanRouteSchema`, `routeSourceSchema`) + catalog-check-ids voor de subset-keuze
2. Crawler-job `scan.crawl`: seed = homepage; bronnen sitemap.xml (parse + valideer), robots.txt (allow-lijst), interne links (max N), SPA-heuristics
3. Normalisatie: query-params, fragments, dedupe, redirect-resolutie, plan-limiet
4. Dispatcher: `scan.crawl` → dependency → fan-out met per-route-params (welke check-set per route)
5. Workers: checks ontvangen route-lijst; `route_url` op findings; progress per route
6. UI: route-filter op de resultatenpagina, route-teller tijdens scan ("N routes ontdekt"), info-finding bij plan-limiet
7. Tests: heuristics (Next.js/Vite), limiet, dedupe/normalisatie, subset-keuze, politeness-timing

## Open vragen

- SPA-heuristics concreet: welke patronen per framework zijn stabiel genoeg (chunk-namen veranderen per build — heeft dat impact op stabiliteit van de crawl?)
- Hoe zwaar is de crawlfase in scan-tijd? (CheckVibe claimt "full report in ~30–60s") — meten en zo nodig subset verkleinen
- CWV op "top-routes": welke definitie van top (eerste N uit sitemap + hoogste interne link-count)?

## Acceptatiecriteria

- [x] Scan ontdekt routes uit sitemap/link-crawl/SPA-heuristics en draait de checks op meerdere routes
- [x] `scan_routes` bevat genormaliseerde, gededupliceerde routes met bron en status; resultatenpagina kan erop filteren
- [x] Plan-limiet werkt (10/150) met info-finding bij de limiet
- [x] Subset-checks draaien op de lange staart; CWV/axe alleen op top-routes
- [x] Crawl respecteert per-host concurrency + politeness; geen oneindige loops (redirect-cap, max routes)
- [x] Findings die op een specifieke route zijn gevonden dragen `route_url`
