# Plan: CrUX field data (real-user CWV naast lab-metingen)

**Doel**: Chrome UX Report (CrUX)-fielddata toevoegen naast de lab-Core Web Vitals (41): per vital de p75-waarde en de good/needs-improvement/poor-fracties van echte Chrome-gebruikers, met een lab/field-divergentie-flag. Dit is CheckVibe's "field data, not lab guesses — the same real-user data Google ranks with".

**Status**: ✅ Klaar (2026-08-18) — `scans.crux`, check in de http-worker, divergentie-finding in de aggregator, UI-kaart lab vs field. Trend-endpoint (v2) is bewust niet gebouwd; de data ligt klaar in `scans.crux`.

## Besluiten (bevestigd 2026-08-16)

1. **HTTP-check, geen browser nodig**: CrUX-API (Google, gratis met API-key via env `CRUX_API_KEY`) is een pure REST-call — de check draait in de http-worker (goedkoop), niet in de Playwright-worker
2. **Opslag**: `scans.crux jsonb` (`{ origin, collection_period, metrics: { lcp: { p75, good, needs_improvement, poor }, inp: {...}, cls: {...} } }`); geen eigen tabel; trends (10) lezen hetzelfde veld
3. **Geen data → niet fout**: domeinen zonder CrUX-dekking (laag verkeer, nieuw domein) → `crux: null` + info-finding "geen field data beschikbaar" (geen score-straf)
4. **Divergentie-flag**: lab vs field per vital met eigen drempels (voorstel: LCP-verschil > 1s, INP > 200ms, CLS > 0,1) → finding `crux-divergence` (medium) met beide waarden — "divergence is the diagnosis"
5. **Rate limiting**: max 1 CrUX-call per scan per site; Redis-cache 24u per origin (de API heeft zelf ook org-limieten)
6. **Budget-alerts** (later): veld-regressie-detectie via diff-monitoring (59) — de data ligt er dan al
7. History API (CrUX) i.p.v. de eenvoudige dataset-API: meerdere periodes voor trends

## Uitgangssituatie (code vandaag)

- Lab-CWV (41) in de browser-worker (Playwright, meerdere loads) — categorie `aeo` in de catalog (plan 06)
- API-keys via env (pattern uit AGENTS.md: geen secrets in code); resultatenpagina (7) met performance-kaart

## Contract / DB / API

- Migratie: `scans.crux jsonb not null default '{}'::jsonb`
- Shared: `cruxMetricSchema`, `cruxDataSchema` (hierboven), catalog-entry `crux-field-data` (categorie `aeo`; subcheck van de performance-groep)
- `GET /api/scans/[id]` retourneert `crux`; resultatenpagina toont lab vs field side-by-side per vital
- `GET /api/sites/[id]/crux` (v2) → field-trend over scans

## Stappen

1. Shared: schema's + catalog-entry; migratie
2. CrUX-client `lib/crux.ts` (worker): API-call (History API), parse + normalisatie, 404/"no data"-afhandeling, Redis-cache 24u, rate-limit
3. http-worker-check: fetch + `scans.crux` schrijven + info-finding bij geen data
4. Divergentie-berekening (in de check of aggregator): thresholds → `crux-divergence`-finding met lab+field-waarden
5. UI: performance-kaart lab/field side-by-side (p75 + fracties), divergentie-badge
6. Tests: API-mock (data, no-data, 429), cache-gedrag, divergentie-drempels, schema-validatie

## Open vragen

- ~~CrUX dekt alleen Chrome-gebruikers op voldoende bezochte origins — acceptabel als "field", of is de dekking-limiet juist een verkooppunt (probeer het te meten)?~~ → **Besloten**: dekking is een feit en wordt eerlijk gecommuniceerd ("geen field data beschikbaar" info-finding, geen score-straf). Voldoende-bezochte origins zijn juist de betalende doelgroep — dekking is een verkooppunt.
- ~~History API vs dataset-API: History heeft een periode-array (handig voor trends) maar andere response-shape — welke API-versie als basis?~~ → **Besloten**: History API (`queryHistoryRecord`); de huidige periode komt in `scans.crux`, `metrics.*.history` blijft beschikbaar voor de trend-uitbreiding.
- ~~Lab-vs-field vergelijken is eerlijk over dezelfde route/URL; de lab-check meet nu de homepage — top-routes (54) later ook?~~ → **Besloten**: crux is origin-level en wordt gemeten op de homepage-seed, hetzelfde pad als de lab-CWV-check. Top-routes (54) blijven een latere uitbreiding.

## Acceptatiecriteria

- [x] Elke scan haalt field-data op (waar beschikbaar) en slaat `scans.crux` op; geen data → info-finding, geen score-straf
- [x] Lab/field-divergentie boven de drempels levert een `crux-divergence`-finding met beide waarden
- [x] Max 1 API-call per scan per site; 24u-cache; 429/rate-limit wordt netjes afgehandeld (check faalt niet hard)
- [x] UI toont p75 + fracties side-by-side; trends kunnen het veld hergebruiken
