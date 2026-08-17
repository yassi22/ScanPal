# Plan: Domain watchtower (expiry, DNS, DNSSEC, CAA, TLS-runway)

**Doel**: Continue domein-gezondheid bewaken — registratie-expiry, transfer-lock, nameserver-drift, DNSSEC, CAA en TLS-certificaat-runway — met alerts ruim vóór het moment dat het bijt (CheckVibe's "Domain Watchtower"). De eerste meting loopt mee in de normale scan (uitbreiding van TLS-check 31); daarna een dagelijkse watch via de bestaande scheduler (plan 05).

**Status**: ✅ Uitgevoerd (2026-08-17).

## Besluiten (bevestigd 2026-08-16)

1. **Catalog-check `domain-watchtower`** (categorie `http`) in de normale scan + **dagelijkse re-check** via de bestaande scheduler (60s-poll met due-tijden; geen nieuwe queue, geen apart proces)
2. **Databronnen**: RDAP over HTTPS (registrar, expiry, status-codes) + DNS via `node:dns` (NS-set, DNSSEC-DS, CAA, SOA) + TLS (cert `notAfter` — hergebruik check 31). RDAP-ratelimits per registrar respecteren; fallback op whois (port 43) waar RDAP ontbreekt
3. **Opslag**: denormaliseerde kolommen op `sites` (`domain_expiry`, `domain_registrar`, `dnssec_enabled bool`, `caa_present bool`, `tls_expiry`) + `domain_events` (alleen veranderingen → bron voor alerts en de 30/90-dagen-weergave)
4. **Alert-rules** (via notificatiehub 13): expiry < 30 dagen, certificaat < 14 dagen, DNSSEC uitgeschakeld, nameserver-wijziging, nieuwe CAA die bot-blokkerend is (basis-check); alleen alert bij *verandering* ten opzichte van de vorige meting
5. **Apex-only**: subdomein-sites meten via hun apex; IDN → punycode
6. Geen juridische claims: "domain expiry" is een RDAP-waarde, geen eigendomsuitspraak

## Uitgangssituatie (code vandaag)

- TLS/SSL-check 31 (geldigheid, chain, HTTP/2) in MVP http-worker — cert-expiry wordt daar al gelezen
- Scheduler-proces `apps/scheduler` (plan 05) met 60s-poll; uptime-worker (50); notificaties (13) in Fase 5
- `sites`-tabel (plan 04) heeft geen domein-velden

## Contract / DB / API

- Migratie: `sites` + `domain_expiry`, `domain_registrar`, `dnssec_enabled`, `caa_present`, `tls_expiry`, `domain_last_checked_at`; nieuwe tabel `domain_events` (`site_id`, `field`, `old_value`, `new_value`, `checked_at`)
- `GET /api/sites/[id]/domain` (authz als sites) → huidige domein-status + recente events
- Finding-uitvoer van de catalog-check: alleen bij afwijking (expiry/runway/dnssec/ns-drift) — de check is stil als alles ok is (behalve een info-finding met de countdown-waarden)
- UI: domein-kaart op de site-detailpagina (expiry-countdown, registrar, DNSSEC/CAA-badges, TLS-geldig-tot)

## Stappen

1. Migratie + shared schema's (`domainStatusSchema`, `domainEventSchema`) + RDAP/DNS-helpers (`lib/domain.ts` in worker met tests)
2. Catalog-check in http-worker: RDAP + DNS + TLS-expiry in één check; finding bij afwijking
3. Dagelijkse watch: scheduler-taak `domain_due` (per site dagelijks) → zelfde check → events bij verandering + alert via notificatiehub
4. UI: domein-kaart + events-geschiedenis; (v2: aparte "Domain watchtower"-widget op de dashboard)
5. Tests: RDAP-parse (mock-responses), whois-fallback, DNS-queries, event-detectie (drift), alert-drempels, apex-resolutie/IDN

## Open vragen

- RDAP-responsen variëren per registrar (status-codes en velden) — hoeveel normalisatie per registrar is acceptabel vóór fallback? → *Beslist*: basis-normalisatie in `parseRdap` (events/sec/old→new); onvolledige of niet-parseerbare RDAP valt terug op whois-TCP.
- Interactie met uptime-worker (50): dezelfde scheduler-process of de uptime-worker de dagelijkse domein-taak laten doen (consolidatie)? → *Beslist*: domein-watch draait in de bestaande scheduler-tick (plan 05), niet in de uptime-worker.
- `domain_events` ook voor handmatige scans, of alleen voor de dagelijkse watch (dubbele events vermijden)? → *Beslist*: alleen de dagelijkse watch schrijft `domain_events`; de catalog-check tijdens een scan schrijft uitsluitend een finding (geen events), zodat er geen duplicaten ontstaan.

## Acceptatiecriteria

- [x] Scan + dagelijkse watch leveren dezelfde domein-status; events worden alleen bij verandering geschreven
- [x] Alert bij expiry < 30d, cert < 14d, DNSSEC-uit, NS-drift (via notificatiehub)
- [x] RDAP fallback whois; apex-only voor subdomeinen; IDN → punycode
- [x] UI toont countdowns en badges; geen storing van de normale scan bij RDAP-timeouts
