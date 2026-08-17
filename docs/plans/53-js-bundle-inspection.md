# Plan: JS-bundle inspectie (sourcemap-aware secrets-extractie)

**Doel**: Uitbreiding van de secrets-check (33): naast HTML ook de JavaScript-bundles van de site scannen op gelekte keys — met sourcemap-ondersteuning (inline `//# sourceMappingURL=` + `.map`-siblings) en provider-specifieke patronen (Stripe, OpenAI, Supabase, Firebase, GitHub, AWS…). Vindt wat een naive HTML-scan mist: keys die alleen in gecompileerde client-bundles zitten (CheckVibe: "source-map-aware extraction").

**Status**: In uitvoering (🚧).

## Besluiten (bevestigd 2026-08-16)

1. **Eigen catalog-check** `secrets-in-bundles` (categorie `http`) — naast `secrets-in-html` (33), die ongewijzigd blijft
2. **Bronnen**: `script src`-URL's uit de HTML + ontdekte bundels tijdens de mini-crawl (38); geen eigen JS-execution
3. **Limieten**: max 25 bundels en 5 MB per bundel per scan; grotere/grotere → skip + info-finding ("bundel niet gescand")
4. **Sourcemaps**: alleen statische parse van inline-comment en sibling `.map` (zelfde host of CDN); maps zelf worden niet opgeslagen, alleen de matches
5. **Patronen**: per provider een regex-set met bekende key-prefixen (`sk_live_`, `pk_live_`, `rk_live_`, `AIza`, `AKIA…`, `sk-…`, `supabase.anon`…) + entropy-drempel voor generieke tokens; **severity naar key-type**: productie-keys (sk_live_) > test/anon-keys (pk_live_, supabase.anon — CheckVibe-onderscheid)
6. **Maskeren**: in UI en rapporten wordt de match afgekapt (eerste 4 + laatste 4 tekens); volledige keys alleen in de API-route bij `scope=full` (plan 10) en nooit in logs
7. Downloads respecteren de per-host rate limiter (verplicht uit AGENTS.md)

## Besluiten (bevestigd 2026-08-17 — uitvoeringsaanpassing)

8. **Basis is de inline probe, niet de (nog niet bestaande) http-worker**: features 27–39 (incl. `secrets-in-html` 33 en mini-crawler 38) zijn nog niet gebouwd. De check is daarom geïmplementeerd als catalog-check die vandaag draait in `apps/web/lib/scan-runner.ts` (inline probe) + `apps/web/lib/bundle-secrets-runner.ts`. De pure logica (patronen, extractor, masker, entropy, schema) ligt in `packages/shared` — als de BullMQ-pipeline (Fase 3) landt, verhuist de runner naar de http-worker zonder contract-wijziging. De `script src`-collectie uit de HTML is nu de bron (mini-crawler-uitvoer komt er later bij).
9. **Dedupe op raw-waarde (in-memory)**: hetzelfde geheim in meerdere chunks/webpack-hashes levert één match per scan (open vraag → opgelost).

## Uitgangssituatie (code vandaag)

- ~~Check `secrets-in-html` (33) in de MVP http-worker (Fase 3)~~ — bestaat nog niet; de check loopt als eigen `secrets-in-bundles`-check in de tijdelijke inline probe (`apps/web/lib/scan-runner.ts`)
- ~~Mini-crawler (38) levert al een link-lijst incl. externe `script src`~~ — bestaat nog niet; de runner extraheert `script src` direct uit de pagina-HTML
- Findings JSONB + catalog in `packages/shared` (plan 06/09)

## Contract / DB / API

- Catalog-entry `secrets-in-bundles` (categorie `http`), geen nieuwe tabellen — findings JSONB
- Finding-detail (evidence `{ kind: "bundle-secrets", matches, notes }`): per match `{ key_type, provider, file (bundel-URL), sourcemap: bool, match_preview (gemaskeerd), severity }`
- `GET /api/scans/[id]/findings` retourneert matches gemaskeerd + `key_types`-lijst (filter-dropdown); filter `key_type=<...>` (plan 53). De export-route (plan 10) `scope=full` mag de gemaskeerde variant óók tonen (geen ongemaskeerde keys in rapporten — besluit 6)

## Stappen

1. `packages/shared`: `bundleSecretPatterns` (constante per provider), `bundleSecretFindingSchema`, masker-helper + tests
2. http-worker: bundel-collectie uit HTML + crawler-output, grootte/limiet-check → *in de inline probe: `extractScriptSrc` uit de pagina-HTML, limieten in `BUNDLE_SCAN_LIMITS`*
3. Download + sourcemap-resolutie (inline comment, sibling `.map`, relatief t.o.v. bundel-URL); HTTP-status 404 → sourcemap-not-found info-finding
4. Scan-code (+ sourcemap `sourcesContent`) met patronen + entropy; severity-classificatie per key-type
5. UI: finding-detail met file, provider-badge, gemaskeerde preview; filter op `key_type`
6. Tests: patroon-validatie per provider, maskeren (nooit > 8 tekens zichtbaar), limieten (25/5MB), sourcemap-relatieve-URL-oplossing, severity-mapping

## Open vragen

- ~~Hoe omgaan met Webpack/Next.js-hashes (hetzelfde "geheim" in meerdere chunks → dedupe op key-hash?)~~ → **Opgelost (2026-08-17)**: dedupe op de raw-waarde in-memory binnen één scan (besluit 9); de DB/UI krijgt alleen de gemaskeerde preview.
- ~~CDN-bundels zonder CORS: gewoon downloaden (geen browser-context nodig), of Playwright-interception hergebruiken?~~ → **Opgelost (2026-08-17)**: server-side `fetch` (geen browser-context); de scan draait sowieso server-side.
- ~~Entropy-drempel instellen zonder te veel false positives — calibratie op een testset van echte vibe-coded sites?~~ → **Opgelost (2026-08-17)**: drempel 3.5 per char (Shannon) voor generieke tokens; provider-patroon met bekende prefixes blijft de primaire detectie. Verdere calibratie kan bij een latere testset.

## Acceptatiecriteria

- [x] Bundels worden gedownload en gescand; inline- én sibling-sourcemaps worden gebruikt
- [x] Provider-patroon per key-type; productie-keys scoren hoger dan test/anon-keys
- [x] Geen enkele key wordt ongemaskeerd getoond in UI, export of logs
- [x] Limieten (25 bundels / 5 MB) werken; overschrijding → info-finding i.p.v. harde fout
- [x] Rate limiting geldt ook voor bundel-downloads
