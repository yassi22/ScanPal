# Plan: Threat Intelligence / reputatie (blocklist & malware-DB lookup)

**Doel**: Beoordelen of het gescande domein en zijn IP('s) voorkomen op publieke blocklists / malware- & phishing-databases — zoals CheckVibe's "Threat Intelligence Scanner". Volledig passief: externe lookups tegen reputatiebronnen, géén interactie met de doelsite. Dit is gap **G8** uit `docs/gap-analysis-checkvibe-security-checks.md` en staat daar als aanbevolen volgorde **#2** (passieve externe lookup, laag risico, headline-waardig: "staat je domein op een blocklist?").

**Status**: ✅ Opgeleverd (2026-08-25). Feature 75.

## Besluiten

1. **Nieuwe catalog-check `threat-intel`** (categorie `http`), draait passief in de http-worker naast `domain-watchtower`/`dns-email`. Geen `active`-gating (leest alleen externe reputatiebronnen; raakt de doelsite niet). Eén site-level finding met de gebundelde reputatie-uitslag.
2. **Vijf bronnen, alle via env-key, elk degradeert netjes bij ontbrekende key** (gemodelleerd naar de crux-key-conventie: geen key ⇒ bron overgeslagen met een info-regel, nooit een fout of score-straf). Beslissing: we nemen álle vijf mee in v1 (geen "later" — de gebruiker wil de volledige dekking).

   | Bron | Wat | Env-key | Aan te vragen |
   |---|---|---|---|
   | **Spamhaus DQS** | IP- (ZEN) + domein-reputatie (DBL) via de **Data Query Service** — een persoonlijke query-key in de DNS-zone, i.p.v. de publieke DNSBL die grote resolvers blokkeert | `SPAMHAUS_DQS_KEY` | ✅ gratis tier op dqs.spamhaus.com |
   | **abuse.ch URLhaus** | malware-URL's op host/domein via REST | `ABUSECH_AUTH_KEY` | ✅ gratis op auth.abuse.ch |
   | **Google Safe Browsing** | malware / social-engineering (phishing) — dezelfde lijst als Chrome | `SAFE_BROWSING_API_KEY` | ✅ gratis via Google Cloud |
   | **VirusTotal** | domein/URL-reputatie, geaggregeerd over ~90 engines | `VIRUSTOTAL_API_KEY` | ✅ gratis tier (4 req/min) |
   | **AbuseIPDB** | IP-misbruikreputatie (confidence-score) | `ABUSEIPDB_API_KEY` | ✅ gratis tier |

   - **Spamhaus-beslissing**: we gebruiken vanaf v1 de **DQS-endpoint met eigen key** — dat omzeilt de publieke-resolver-blokkade volledig en schaalt via de betaalde tiers zonder codewijziging. We bouwen dus **niet** op de gratis publieke DNSBL (die valt af).
   - DNSBL-transport (DQS is óók DNS-gebaseerd) herbruikt de bestaande swappable `dnsResolver` uit `domain-net.ts`; de drie REST-bronnen (URLhaus/VirusTotal/AbuseIPDB) + Safe Browsing zijn losse clients met korte timeout.
   - Als **geen enkele** key gezet is, levert de check één info-finding ("geen reputatiebronnen geconfigureerd") zonder score-straf — de check faalt nooit op ontbrekende config.
3. **Score/finding-regels** (severity volgt het vertrouwen van de bron én de aard van de listing):
   - `high` — hit op een malware/phishing-bron (Safe Browsing `MALWARE`/`SOCIAL_ENGINEERING`, Spamhaus DBL, of URLhaus-hit).
   - `medium` — IP op een spam/abuse-lijst (Spamhaus ZEN → SBL/XBL/PBL-return-codes), of listing op één lager-vertrouwde bron.
   - `low` — enkele twijfelachtige/verouderde listing op één bron zonder corroboratie.
   - `info` — schoon op alle bevraagde bronnen (expliciete "geen listings gevonden"), óf géén enkele bron bereikbaar/geconfigureerd (dan geen score-straf).
4. **Resolutie apex + IP's**: domein → punycode (consistent met plan 56/68), A/AAAA-resolutie via de bestaande resolver om de te-bevragen IP's te bepalen. Bij CDN/proxy (bv. Cloudflare) staat het IP van de edge, niet van de origin — dat wordt in de evidence gemarkeerd zodat een edge-IP-listing niet als origin-oordeel wordt gelezen.
5. **Geen valse stelligheid**: de finding zegt "gevonden op blocklist X (bron, tijdstip van meting)", niet "je site is malware". Listings kunnen verouderd zijn → fix-prompt verwijst naar de delisting-procedure van de betreffende bron.
6. **Caching + rate-limit-respect**: reputatie verandert traag. Cache per host/IP (bv. `threat-intel:${host}`) met TTL ~6–24u (zelfde cache-patroon als `dns-email`), zodat herhaalscans de externe bronnen niet hameren en we binnen hun free-tier-limieten blijven.

## Uitgangssituatie (code vandaag)

- `packages/scan-core/src/domain-net.ts` — swappable `dnsResolver` (`resolveNs`, `resolveTxt`, `resolveMx`, `resolveCaa`, generieke `resolve(...)`). Geen A/AAAA- of DNSBL-helper, geen reputatie-veld.
- `apps/worker/src/checks/http/crux-field-data.ts` — referentiepatroon voor een externe-API-check met env-key en nette skip bij ontbrekende key.
- Geen threat-intel/reputatie-check in `check-catalog.ts` of de registry (geverifieerd: catalog kent geen `threat`/`reputation`/`blocklist`-id).
- `12-threat-alerts.md` gaat over **notificaties** (domain-watchtower-alerts), niet over reputatie-lookup — los hiervan.

## Contract / DB / API

- **Shared**: `reputationSchema` in `packages/scan-core` (of `packages/shared`):
  `{ host, ips: string[], edge_detected: boolean, sources: Array<{ source, queried: boolean, listed: boolean, categories?: string[], detail?: string }>, worst_severity }`.
- **Catalog**: entry `{ id: "threat-intel", category: "http", name: "Threat Intelligence & reputatie", active: false }` in `check-catalog.ts`, registreren in `apps/worker/src/checks/registry.ts` (http-queue, naast `dnsEmailCheck`).
- **Findings**: severity-regels uit besluit 3; evidence = per bron `{queried, listed, categories, detail}` + de bevraagde IP's en of een edge-IP is gedetecteerd.
- **Config / prerequisites (aan te vragen vóór implementatie — allemaal gratis voor laag volume)**: `SPAMHAUS_DQS_KEY`, `ABUSECH_AUTH_KEY`, `SAFE_BROWSING_API_KEY`, `VIRUSTOTAL_API_KEY`, `ABUSEIPDB_API_KEY` — documenteren naast de bestaande `CRUX_API_KEY`. Elke key is optioneel op zich (bron skipt netjes), maar minstens één is nodig voor een reputatie-oordeel. **Actiepunt vóór start**: de vijf gratis keys aanvragen en in de worker-env zetten.
- **DB**: optioneel denormaliseren op `sites` (`reputation_status`, `reputation_sources`) alléén als de UI een reputatie-badge op de site-detailpagina wil; niet vereist voor de finding-output.
- **UI**: bevindingen verschijnen in de bestaande findings-lijst (categorie HTTP). Geen aparte pagina nodig.

## Stappen

0. **Prerequisite productie**: de vijf gratis keys aanvragen (Spamhaus DQS, abuse.ch, Safe Browsing, VirusTotal, AbuseIPDB) en in de worker-env zetten. De implementatie en no-key-paden zijn zonder keys testbaar en opgeleverd.
1. `packages/scan-core/src/domain-net.ts`: helper `resolveIps(apexPunycode, deps)` (A/AAAA via de bestaande resolver) + `querySpamhausDqs(ip|host, key, deps)` (DQS-zone met key → A-lookup, return-codes → categorie). Pure parse-helpers met unit-tests op de mock-resolver.
2. `packages/shared` (of scan-core): `reputationSchema` + pure `classifyReputation(sources)` → `worst_severity` volgens besluit 3. Unit-getest op elke bron-combinatie.
3. Externe-bron-clients: `urlhausLookup`, `virusTotalLookup`, `abuseIpdbLookup`, `safeBrowsingLookup` — elk met eigen key, korte timeout, en per-bron `queried:false` bij ontbrekende key/fout/timeout (nooit de hele check laten falen op één trage of niet-geconfigureerde bron).
4. Catalog-entry + registratie; `threat-intel`-check die IP's resolveert, alle vijf bronnen parallel bevraagt (met cache uit besluit 6) en `classifyReputation` toepast op één site-level finding.
5. Fix-prompt-tekst (plan 60): per bron de concrete delisting-link/-procedure (Spamhaus removal, Google Search Console security-issues, URLhaus, VirusTotal, AbuseIPDB).
6. Tests: schoon-op-alles → info; Spamhaus-hit → medium/high; Safe-Browsing/VirusTotal malware → high; geen enkele key → één info-finding zonder straf; één bron zonder key → overgeslagen terwijl de rest gewoon uitlevert; edge-IP-markering; cache-hit bevraagt de bron niet opnieuw.

## Besliste keuzes (waren open vragen)

- **Spamhaus** → ✅ **DQS met eigen key vanaf v1** (niet de geblokkeerde publieke DNSBL). Schaalt via betaalde tiers zonder codewijziging.
- **URLhaus** → ✅ meenemen; vereist de gratis `ABUSECH_AUTH_KEY` (aanvragen op auth.abuse.ch — nog niet in bezit).
- **Premium-bronnen** → ✅ **alle drie in v1**: Google Safe Browsing + VirusTotal + AbuseIPDB.

## Open vragen (resterend)

- ~~**Cache-TTL**: 6u, 12u of 24u?~~ → **Besloten: 12u default, config-baar via `THREAT_INTEL_CACHE_TTL_SECONDS`.**
- **ToS/legal per bron**: sommige reputatie-API's beperken geautomatiseerd/commercieel gebruik. → Vóór productie de ToS van elke bron verifiëren (m.n. Safe Browsing acceptable-use, Spamhaus DQS-tier-voorwaarden, VirusTotal free-tier "non-commercial"). Dit kan per bron de commerciële inzetbaarheid beperken — checken vóór livegang.

## Acceptatiecriteria

- [x] `threat-intel` levert één site-level finding met per-bron evidence (bevraagd / gelist / categorie) voor alle vijf bronnen, inclusief de bevraagde IP's.
- [x] Elke bron draait alleen mét zijn key en degradeert anders naar een info-regel zonder score-straf; géén key gezet ⇒ één info-finding zonder straf.
- [x] Een trage/onbereikbare/niet-geconfigureerde bron laat de check niet falen (per-bron `queried:false`, andere bronnen leveren gewoon uit).
- [x] Edge-/proxy-IP wordt in de evidence gemarkeerd zodat een edge-listing niet als origin-oordeel leest.
- [x] Herhaalscans binnen de TTL bevragen de externe bronnen niet opnieuw (cache-hit getest).
- [x] Pure `classifyReputation`- en DNSBL-parse-helpers zijn unit-getest op mock-responses; geen echte netwerk-calls in de tests.
- [x] Fix-prompt bevat per bron een concrete delisting-link.
