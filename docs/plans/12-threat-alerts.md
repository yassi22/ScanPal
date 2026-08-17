# Plan: Threat-alerts — honeypot + patroon-detectie

**Doel**: Pro-only threat monitoring (feature 12, v2). Per site een ScanPal-gehoste honeypot-URL die de klant verborgen op de site plaatst; elke hit wordt gelogd en geanalyseerd op aanvalspatronen, met een apart Threats-paneel en alerts via de notificatiehub (plan 13).

**Status**: ✅ klaar (alerts-koppeling naar de hub volgt met plan 13)

## Besluiten (bevestigd 2026-08-16)

1. **Honeypot = ScanPal-gehoste geheime URL** per site (`GET /h/{token}`): ScanPal kan niets op de klantsite installeren; de klant plaatst een verborgen link/snippet. Elke hit op een URL die nooit publiek is = probe/attacker.
2. **Patroon-detectie op honeypot-hits** (geen klant-log-upload): burst-detectie, verdachte paden (wp-login, .env, traversal), user-agent-blacklist, herhaling vanaf zelfde IP/ASN.
3. **Apart Threats-paneel** (`(dashboard)/threats`) met real-time events + mail/in-app-alerts via plan 13; threat-events komen **niet** in scan-findings.
4. **Pro-only**: honeypot aanzetten + paneel + alerts zijn Pro-gated (Free → 403 + upsell).
5. Migratie **`010_threat_alerts.sql`** claimen (009 = plan 13, 008 = plan 14; afstemmen bij merge).
6. v1 draait analyse inline bij de hit (laag volume); zodra de BullMQ-pipeline (Fase 3) er is → `threat.analyze`-queue.
7. **Alerts-koppeling uitgesteld** (bevestigd 2026-08-16): de notificatiehub (plan 13) bestaat nog niet → de analyse zet `matched_rule` + risk op het event; mail/in-app-verzending + `dedup_key`-logica wordt pas bij plan 13 toegevoegd (de hub krijgt `threat_detected` als event-type).

## Uitgangssituatie (code vandaag)

- Geen threat-code; `threat_alerts` staat alleen als naam in het AGENTS.md/db-diagram.
- Uptime-poller (plan 11 ✅) is de enige bestaande bewaak-laag; de notificatiehub bestaat nog niet (plan 13).
- Feature 12 is expliciet v2 (FEATURES.md); nog geen plan — dit plan.

## Contract / DB / API

**Migratie 010**:
- `threat_honeypots` (id, site_id FK, token, enabled, hit_count, created_at) — 1 per site, token = 32 random bytes
- `threat_events` (id, team_id, site_id, honeypot_id, kind `hit|pattern`, risk `low|medium|high|critical`, path, ip, user_agent, country, asn, matched_rule, payload JSONB, created_at) + indexes (team_id, created_at desc), (site_id), (ip)
- `threat_rules` (id, name, rule_key, risk, description, enabled) — seed: `burst`, `path_admin`, `path_env`, `path_traversal`, `ua_scanner`, `ip_repeat`

**Routes**:

| Route | Rechten | Beschrijving |
|---|---|---|
| `GET /h/[token]` | publiek | honeypot-decoy: hit loggen + analyse, antwoord 404 (geen auth, no-index) |
| `GET /api/threats` | Pro | overzicht per site: hits, actieve patronen, laatste event |
| `GET /api/threats/events` | Pro | gefilterde events (risk/site/tijd, paginated) |
| `POST /api/sites/[id]/honeypot` | Pro | enable/disable + token-rotatie; geeft install-snippet |

**Analyse** (v1 inline): bij een hit → event-rij + regels over recente events van die site/IP (burst: ≥5 hits in 60s; path-regex; UA-blacklist; zelfde IP ≥3× in 24u). Resultaat ≥ high → alert via hub (plan 13) + `matched_rule` op het event.

**Alerts**: risk `high`/`critical` → notificatiehub (`threat_detected`) — mail + in-app; dedup 1× per rule per site per dag (hub-`dedup_key`).

**UI**: `(dashboard)/threats` — per site: honeypot-status + toggle, install-snippet (copy-paste), events-tabel met filters + risk-badges, patroon-kaarten met advies (token roteren, IP-range blokkeren, logs bekijken). Free-plan → upsell.

## Stappen

1. Migratie 010 + seeds + db-types + shared zod (`threatEventSchema`, `threatHoneypotViewSchema`, `honeypotSnippetSchema`) ✅
2. Honeypot-route `GET /h/[token]` (fast-path: hit inserten, async analyse via `after()`) + dedup per IP/window (10s) + 404-decoy ✅
3. Analyse-laag `lib/threat-rules.ts` (regels uit `threat_rules`, inline v1) ✅
4. API-routes + Pro-gate (403 + upsell-payload, patroon uit plan 03) ✅
5. Paneel-UI + snippet-knop + events-tabel ✅
6. Alerts koppelen aan de hub (plan 13; risk ≥ high) — **uitgesteld**: zie besluit 7; de analyse zet `matched_rule` + risk al op het event
7. Tests: hit-logging, regels (burst/path/UA/IP), gating, paneel-query's; lint + typecheck ✅
8. FEATURES.md + ROADMAP.md bijwerken ✅

## Open vragen

- ~~Honeypot-vorm?~~ → ScanPal-gehost (bevestigd 2026-08-16). ~~Log-bron?~~ → honeypot-hit patronen (bevestigd). ~~Presentatie?~~ → apart paneel + alerts (bevestigd). ~~Gating?~~ → Pro-only (bevestigd).
- ~~Honeypot-host: subdomein van de app (`/h/{token}`) of apart domein?~~ → apart domein mogelijk via `HONEYPOT_BASE_URL`-env (opt-in, bevestigd 2026-08-16); default is de app-URL. De route zelf zit op `/h/{token}`.
- ~~Anti-DoS op `GET /h/[token]`?~~ → v1 DB-dedup per IP/window (10s: alleen hit_count ophogen, geen event; bevestigd 2026-08-16). Redis rate-cap volgt met de rate-limit-laag (feature 26).
- ~~Geo/ASN-lookup (MaxMind .mmdb)?~~ → v1 zonder geo (alleen IP/UA/path/burst; bevestigd 2026-08-16). Kolommen `country`/`asn` staan al in de tabel voor later.
- ~~Token-rotatie automatisch bij het opheffen van een alert, of handmatig?~~ → handmatig via de rotatie-knop in het paneel (bevestigd 2026-08-16).

## Acceptatiecriteria

- [x] Honeypot aanzetten per site → geheime URL + snippet; elke hit verschijnt als event (ook zonder analyze-resultaat)
- [x] Regels detecteren burst, verdachte paden, scanner-UA's en IP-herhaling; `matched_rule` + risk op het event
- [x] Risk ≥ high → `matched_rule` + risk worden op het event gezet; de **hub-koppeling** (mail + in-app, 1× per rule per site per dag) is uitgesteld naar plan 13 en wordt daar afgerond
- [x] Threats-paneel: overzicht + events-filters + snippet-copy; Free-plan krijgt upsell (403), Pro werkt
- [x] `GET /h/[token]` is publiek bereikbaar zonder login en antwoordt 404 (decoy), no-index
- [x] Tests, lint en typecheck groen
