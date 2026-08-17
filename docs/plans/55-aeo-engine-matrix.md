# Plan: AEO per-engine matrix (bot-toegang + llms.txt)

**Doel**: Uitbreiding van de AEO-scan (43): per AI-engine — ChatGPT (GPTBot), Claude (ClaudeBot), Perplexity (PerplexityBot), Google AI (Google-Extended), Microsoft Copilot, Meta AI (CCBot), Mistral — testen of de bot de site kan bereiken (robots.txt per UA, WAF-blokkering) én of de kerncontent zonder JavaScript te parsen is. Resultaat is een per-engine matrix in de UI, plus een llms.txt-aanwezigheids- en parsetest. Dit is CheckVibe's "per-engine access matrix".

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-16)

1. **Eigen catalog-check** `aeo-engine-matrix` (categorie `aeo`), naast `aeo-scan` (43); resultaten gegroepeerd in één finding per engine of één finding met `matrix`-object — **keuze: één finding met `engine_matrix`-object** (tabel in UI, geen finding-spam)
2. **Drie metingen per engine**: (a) robots.txt-parse met de UA-regels van die bot, (b) HTTP-probe met bot-UA op de homepage + 2 representatieve routes, (c) "renderless parse"-test: de ruwe HTML (zonder JS) moet titel, headings en voldoende tekstdichtheid bevatten
3. **llms.txt**: bestaan + parse (max 10 MB, links in het bestand geldig) als eigen sub-check; onderdeel van dezelfde catalog-check
4. **Geen echte AI-API-calls**: bot-constanten (UA + engine-namen) in `packages/shared`; meting is een proxy-signaal — in de UI gelabeld als "indicatief" (Google gebruikt bijv. IP-allowlists, een UA-probe zegt niet alles)
5. **Beleefdheid**: 1 probe per engine per route, robots.txt-cache per scan, per-host rate limiting van toepassing
6. Progress: de matrix-check draait als één check in de catalog (geen per-engine progress-splitsing)

## Uitgangssituatie (code vandaag)

- Check 43 (`aeo-scan`: JS-gerenderde content check, LLM-parsability) in MVP browser-worker; robots-sitemap check (36) bestaat
- Progress-categorieën `http | seo | aeo | github` (plan 06); findings-schema versioned
- Geen bot-UA-constanten of llms.txt-logica in `packages/shared`

## Contract / DB / API

- `packages/shared`: `aiEngineSchema` (7 engines), `engineMatrixSchema` (`{ engine, reachable, parseable, reason }[]`), `llmsTxtSchema` (`{ present, parseable, link_errors }`), bot-UA-constanten
- Findings JSONB: `aeo-engine-matrix`-finding draagt `{ engine_matrix, llms_txt }`
- UI: matrix-tabel op de resultatenpagina (rij = engine, kolommen = bereikbaar / parseerbaar / reden) + llms.txt-kaart

## Stappen

1. `packages/shared`: engine-schema's + bot-UA-constanten + robots-parse-helper per UA (hergebruik robots-parse uit check 36) + tests
2. HTTP-deel (http-worker of browser-worker — keuze: http-worker, geen browser nodig): robots.txt per engine + UA-probes op 3 routes + renderless parse
3. llms.txt-check: fetch, grootte-limiet, link-validatie
4. Aggregatie: matrix-berekening + 1 finding met `engine_matrix`; scorebijdrage aan categorie `aeo`
5. UI: matrix-tabel + llms.txt-status + "indicatief"-label
6. Tests: robots-parse per UA, probe-gedrag (WAF → reason), renderless-parse-thresholds, llms.txt-limieten

## Open vragen

- Welke "representatieve routes" (homepage + top-2 uit route-discovery 54, of sitemap-eerste 2?) — afhankelijk van volgorde t.o.v. plan 54
- Blokkeert de eigen CDN/WAF ons IP bij vreemde UAs (Cloudflare "block ai bots"-toggle is standaard)? — eigen probe kan dan een 403 krijgen die een echte AI-bot ook krijgt (correct signaal!) of een false positive
- Engelse vs Nederlandse matrix-labels — labels zijn al Engels in de catalog

## Acceptatiecriteria

- [ ] Matrix toont 7 engines met bereikbaarheid + parseerbaarheid + reden (robots-blokkering, WAF, JS-only, ok)
- [ ] llms.txt wordt gevonden, geparsed en gelinkt; errors als finding
- [ ] Geen AI-API-calls; alles is een proxy-meting op basis van botspecificaties in `packages/shared`
- [ ] "Indicatief"-label in de UI; robots.txt wordt per UA correct geïnterpreteerd
- [ ] Beleefdheid: 1 probe per engine per route; rate limiting actief
