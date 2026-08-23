# Plan: Subdomain-takeover detectie (G6)

**Doel**: Dangling-CNAME-subdomeinen ontdekken die vatbaar zijn op takeover — zoals CheckVibe's "Subdomain Takeover Scanner". Passief: leest alleen publieke DNS-records en publieke certificaat-transparantie-logs; geen interactie met de doelsite. Hergebruikt de swappable `dnsResolver` uit `packages/scan-core/src/domain-net.ts` (plan 56/68) voor CNAME/A-resolutie en de sitemap-parse uit `robots-sitemap` (feature 36) als subdomein-bron.

**Status**: 📝 Plan klaar (niet gestart). Feature 72. Dekt gap G6 uit `docs/gap-analysis-checkvibe-security-checks.md`.

## Besluiten

1. **Nieuwe catalog-check `subdomain-takeover`** (categorie `http`), draait passief in de http-worker naast `dns-email` en `domain-watchtower`. Geen `active`-gating (leest alleen publieke DNS + publieke CT-logs).
2. **Subdomein-bron — gelaagd, oplopend in kost** (de kost zit in de bron, niet in de detectie — zie gap-analyse G6):
   - **Laag 1 (gratis, hergebruik):** hostnames uit de sitemap die `robots-sitemap` (feature 36) al fetcht. Filter op subdomeinen van de apex (`<label>.<apex>`), exclusief apex zelf en `www`-apex. Hergebruik de al geparsede sitemap-URL's; geen extra fetch.
   - **Laag 2 (passieve externe API):** Certificate Transparency via `crt.sh` — `https://crt.sh/?q=%25.<apex>&output=json`. Eén publieke GET, korte timeout; bij falen/time-out valt de check terug op laag 1 (geen crash). Dit is de primaire enumeratie-bron.
   - **Niet in v1:** brute-force woordenlijst. Scope-gevoelig, ruisig, hoge false-positive-kans en belast de eigen resolver. Wordt als opt-in achter plan 52 (`active: true`) geparkkeerd, niet standaard aan.
3. **Dangling-CNAME-detectie** per kandidaat-subdomein, via de bestaande `dnsResolver`:
   - `resolveCname(<sub>)` → CNAME-target indien aanwezig.
   - `resolve4(<sub>)` en `resolve4(<cname-target>)` → A-records.
   - **Vatbaar (high):** CNAME aanwezig én het target-resolve geeft NXDOMAIN (target bestaat niet meer) én het target valt binnen een bekende vulnerable-service-suffixlijst (`github.io`, `herokuapp.com`, `azurewebsites.net`, `s3.amazonaws.com`, `cloudfront.net`, `blob.core.windows.net`, `elasticbeanstalk.com`, `fastly.net`, `ngrok.io`, `surge.sh`, `wordpress.com`, `tumblr.com`).
   - **Vatbaar (medium):** CNAME aanwezig én target NXDOMAIN, maar target niet in de suffixlijst (mogelijk takeover-baar, niet bevestigd).
   - **Info:** subdomeinen gevonden maar allemaal resolvend (geen gat); of geen subdomeinen gevonden.
4. **Apex-only scope**: alleen subdomeinen van de `registrableDomain` van de gescande host; IDN → punycode (consistent met plan 56/68). Subdomeinen van andere apexen (gevonden via CT) worden genegeerd.
5. **Geen valse stelligheid**: de check zegt "CNAME naar `<target>` resolvend naar NXDOMAIN — mogelijk vatbaar op takeover", niet "je subdomein is overgenomen". Bevestiging vereist handmatige claim-probe.
6. **Rate-limit**: crt.sh is een externe publieke dienst — één request per scan, met backoff bij 429/5xx; de DNS-resoluties lopen gebatched met de bestaande per-host rate-limit (`dns-takeover:<apex>`).

## Uitgangssituatie (code vandaag)

- `packages/scan-core/src/domain-net.ts` — `DomainDeps.dnsResolver` (swappable `node:dns/promises`) doet al `resolveNs`/`resolve`/`resolveCaa`/`resolveTxt`/`resolveMx`. `resolveCname` en `resolve4` zijn direct herbruikbaar op dezelfde resolver; geen nieuwe infra.
- `apps/worker/src/checks/http/robots-sitemap.ts` — `inspectSitemap` parseert sitemap-URL's al; de lijst hostnames is herbruikbaar als laag-1-bron (exporteren van de gevonden URL's, of de sitemap opnieuw parsen in de nieuwe check — voorstel: laatste, om koppeling los te houden).
- Geen subdomein- of takeover-velden in catalog of DB. `crt.sh` wordt nergens aangeroepen.

## Contract / DB / API

- **Shared**: `SubdomainTakeoverSchema` in `packages/shared`: `{ subdomains_found: string[], vulnerable: { subdomain: string, cname_target: string, service: string | null, severity: "high" | "medium" }[], sources: ("sitemap" | "crtsh")[] }`.
- **Catalog**: entry `{ id: "subdomain-takeover", category: "http", name: "Subdomain-takeover (dangling CNAME)", active: false }` in `check-catalog.ts`, registreren in `apps/worker/src/checks/registry.ts`.
- **Findings**: severity-regels uit besluit 3; evidence = de gevonden subdomeinen + per vatbare subdomein de CNAME-target en service-suffix.
- **DB**: geen denormalisatie op `sites` in v1; de finding-output volstaat.
- **UI**: bevindingen verschijnen in de bestaande findings-lijst (categorie HTTP). Geen aparte pagina.

## Stappen

1. `packages/scan-core/src/domain-net.ts`: helper `enumerateSubdomains(apexPunycode, deps)` → crt.sh-lookup (laag 2) + optioneel sitemap-hostnames (laag 1); pure dedup + apex-filter. Helper `probeCnameTakeover(subdomainPunycode, deps)` → `resolveCname`/`resolve4` + vulnerable-service-suffix-match. Beide met unit-tests op mock-resolver/mock-fetch.
2. `packages/shared`: `VULNERABLE_SERVICE_SUFFIXES`-lijst + `SubdomainTakeoverSchema` + pure parse-helpers (`extractCtSubdomains`, `classifyTakeover`).
3. Catalog-entry + registratie; `subdomain-takeover`-check die `enumerateSubdomains` + `probeCnameTakeover` aanroept en de severity-regels toepast.
4. Fix-prompt-tekst (plan 60): concrete remediatie — verwijder de CNAME, of her-claim het cloud-resource-eindpunt.
5. Tests: dangling CNAME naar `herokuapp.com` (high), dangling CNAME naar onbekend target (medium), resolvend subdomein (info), crt.sh-faal → fallback op sitemap-only, IDN/apex-filter, geen subdomeinen (info).

## Vastgelegde keuzes (voorheen open vragen)

- **crt.sh-betrouwbaarheid**: crt.sh in v1 met korte timeout + fallback naar sitemap-only (laag 1) bij 429/5xx/time-out. Alternatieve CT-bron (Google CT-lookup, Censys) pas als crt.sh in de praktijk te onbetrouwbaar blijkt — niet vooraf bouwen.
- **Sitemap-hergebruik vs. opnieuw parsen**: de nieuwe check fetcht en parst de sitemap zelf (laag 1), los van `robots-sitemap`. Eén extra fetch is goedkoper dan een koppeling onderhouden, en de check faalt onafhankelijk van `robots-sitemap`.
- **`www` en apex uitsluiten**: `www.<apex>` en de apex zelf worden niet als takeover-kandidaat geprobed, maar wel opgenomen in `subdomains_found` voor transparantie.

## Acceptatiecriteria

- [ ] `subdomain-takeover` levert een `high`-finding voor een dangling CNAME naar een bekende vulnerable-service-suffix, met CNAME-target en service als evidence.
- [ ] Levert `medium` voor een dangling CNAME naar een onbekend target, `info` voor resolvende subdomeinen of geen subdomeinen.
- [ ] Hergebruikt de bestaande swappable resolver (`resolveCname`/`resolve4`); geen nieuw proces/queue; apex-only + IDN→punycode.
- [ ] crt.sh-faal/time-out degradeert naar sitemap-only (laag 1); geen crash, wel een info-finding dat enumeratie onvolledig is.
- [ ] Geen brute-force in v1 (geen woordenlijst, geen `active`-flag nodig).
- [ ] Pure helpers (`extractCtSubdomains`, `classifyTakeover`, `probeCnameTakeover`) zijn unit-getest op mock-DNS/mock-CT-responses.
