# Plan: File Upload Security Scanner (unrestricted upload / RCE)

**Doel**: Bestand-upload-functies van een geverifieerde eigen site beoordelen op onbeperkte uploads en uitvoerbaarheid — zoals CheckVibe's "File Upload Security Scanner". Dit is gap **G10**, een actieve test met RCE-risico: er worden bestanden naar de doelserver geüpload. Daarom draait hij als **actieve test met onschadelijke canary** achter dezelfde driedubbele gating als de Auth Flow Scanner (G9): opt-in + Pro (plan 52) **én** bewezen domeineigendom (plan 76) **én**, voor upload-forms achter login, een door de gebruiker geleverd wegwerp-testaccount.

**Status**: 📝 Plan klaar (niet gestart). Feature 78. Voorwaarden: plan 52 (actieve-test-gating, klaar) + plan 76 (eigendom-verificatie, opgeleverd).

## Besluiten

1. **Agressiviteit: actief met onschadelijke canary** (bewust géén echte RCE-payload). We uploaden een ongevaarlijk bestand met een verkeerde extensie/content-type — bijvoorbeeld een `.php`/`.svg`/`.html` dat enkel een uniek willekeurig **token** teruggeeft. Zo bewijzen we "onbeperkte upload / uitvoerbaar" zónder ooit malware of een echte webshell te plaatsen.
2. **Driedubbele gating** (skip-met-info-finding als één ontbreekt, nooit een fout):
   - `active: true` + opt-in + Pro-plan (erft plan 52).
   - **Domeineigendom live geverifieerd** via `verifyOwnershipLive(siteId)` (plan 76) op dispatch-moment.
   - Voor upload-forms **achter login**: een wegwerp-testaccount aanwezig (encrypted, plan 52/77-credentialpatroon). Publieke upload-forms hebben géén credentials nodig.
3. **Draait in de browser-worker** (Playwright): upload-form-discovery + het invullen/versturen van multipart-forms vereist DOM-interactie. Herbruikt `apps/worker/src/checks/browser/playwright-runner.ts` en de crawl-hints uit plan 54.
4. **Canary + verificatie-ladder** — één upload-poging, daarna ophalen van het opgeslagen bestand op de teruggegeven URL, en de uitkomst classificeren:
   - `high` — bestand opgeslagen **én uitgevoerd** (token verschijnt als *server-side output*, niet als broncode) → onbeperkte upload met executie (RCE-klasse).
   - `high` — gevaarlijk actief type (`.svg`/`.html`) opgeslagen én publiek opvraagbaar → stored-XSS-vector.
   - `medium` — gevaarlijke extensie/content-type geaccepteerd en opgeslagen, maar niet uitvoerbaar/opvraagbaar → zwakke server-side filtering.
   - `low` — alleen client-side beperking (accept-attribuut) maar server accepteert alsnog → schijnbeveiliging.
   - `info` — server weigert correct (extensie + content-type + magic-bytes) → pass.
5. **Probe-set (klein, curated, constante in `packages/shared`)** — extensie/content-type-mismatch (`shell.php` als `image/jpeg`), dubbele extensie (`shell.php.jpg`), content-type-sniffing (afbeelding met script-body), ontbrekende groottelimiet (begrensd groot testbestand), en filename-path-traversal (`../canary.txt`, veilig geneutraliseerd — nooit buiten een testpad schrijven).
6. **Niet-destructief, begrensd, met opruiming**: vaste kleine probe-set, timeout per probe, per-host Redis-rate-limit (AGENTS.md-eis). Waar de app een delete-functie biedt, ruimt de scan de canary daarna op; anders blijft een onschadelijk tokenbestand achter op de **eigen geverifieerde** site (genoteerd in de finding). Geen brute-force, geen willekeurige nieuwe routes.
7. **Aparte score-behandeling** (plan 52 besluit 3): findings krijgen `active: true`, staan in de "Active tests"-sectie en tellen **niet** mee in de overall-score. Evidence = request/response (afgekapt ~4KB).
8. **Geen valse stelligheid**: bevindingen beschrijven waargenomen gedrag ("`.php` als `image/jpeg` werd geaccepteerd en opgehaald met token in de output → uitvoerbaar"), geen absolute claims.

## Uitgangssituatie (code vandaag)

- Plan 52 (klaar): `active_tests`-flag, Pro-gate, `active-tests`-fan-out, encrypted credential-opslag, evidence-schema, `active: true`-filter.
- Plan 76 (opgeleverd): `verifyOwnershipLive(siteId)` als harde gate.
- Plan 77 (G9): patroon voor een browser-worker actieve-test met wegwerp-account + ownership-gate — direct te spiegelen.
- `browser/playwright-runner.ts` + crawl (plan 54) voor form-discovery.
- Geen file-upload-check in de catalog (geen `upload-*`-id aanwezig).

## Contract / DB / API

- **Catalog**: kleine set `upload-*`-ids (`active: true`), bv. `upload-unrestricted-type`, `upload-executable`, `upload-content-sniff`, `upload-size-limit`, `upload-path-traversal` — één implementatie produceert ze (patroon zoals security-headers/plan 77).
- **Credentials**: hergebruik plan 52/77 wegwerp-testaccount voor achter-login forms; zonder → alleen publieke forms + info-finding voor de rest.
- **Dispatch/gating** (plan 27 + 52): upload-jobs alleen fannen als `active_tests` **én** `verifyOwnershipLive` **én** (voor auth-forms) credentials.
- **Findings**: `active: true`, `evidence:{request,response}`, severity per besluit 4; niet in overall-score.
- **UI**: erft de plan 52 "Actieve tests (Pro)"-toggle + de plan 76 "verifieer eerst eigendom"-hint. Resultaten in de bestaande active-tests-sectie.

## Stappen

1. Catalog: de `upload-*`-ids (`active:true`) + registratie in de browser-queue van `registry.ts`.
2. Gating-laag: dispatch skipt tenzij `active_tests` + `verifyOwnershipLive(siteId)`; auth-forms extra achter credentials.
3. Upload-form-discovery (Playwright + crawl): `<input type=file>`-forms vinden, publiek en (met wegwerp-account) achter login.
4. Probe-set als constante in `packages/shared` (besluit 5); pure helper `classifyUploadOutcome(stored, retrievable, executed, type)` → severity, unit-getest.
5. Canary-upload + retrieval-ladder (besluit 4) per gevonden form; opruimen waar mogelijk (besluit 6).
6. Fix-prompt-tekst (plan 60): allowlist-extensies, content-type + magic-byte-validatie, uploads buiten de webroot / niet-uitvoerbaar serveren, random bestandsnamen, groottelimiet.
7. Tests: gating (geen ownership → skip; geen creds → alleen publiek; niet-Pro → 403), non-destructiviteit (geen echte payload, path-traversal geneutraliseerd), classificatie-ladder op mock-responses, evidence-afkapping, rate-limit/timeout.

## Open vragen

- **Executie-bevestiging vs. alleen opslag**: het token uit een *uitgevoerd* script halen bewijst RCE hard, maar vereist dat we het bestand ook ophalen/triggeren. → *Voorstel*: ophalen tot en met retrieval; "uitgevoerd" alleen claimen als de output verschilt van de ruwe bron. Als ophalen niet lukt, degradeert naar `medium` (geaccepteerd maar onbevestigd).
- **Canary-opruiming**: veel apps bieden geen programmatische delete. → *Voorstel*: opruimen waar een delete-UI bestaat; anders het achtergelaten tokenbestand expliciet in de finding melden (eigen geverifieerde site, dus acceptabel).
- **Welke actieve types proben**: `.php/.jsp/.asp/.aspx/.svg/.html/.phtml`? → *Voorstel*: kleine curated set, uitbreidbaar; niet elke exotische extensie.
- **Path-traversal-veiligheid**: een echte `../`-write kan schade doen. → *Voorstel*: alleen detecteren of de filename ongefilterd terugkomt/geaccepteerd wordt, nooit daadwerkelijk buiten een testpad schrijven.

## Acceptatiecriteria

- [ ] Upload-scan draait alleen met `active_tests:true` + Pro **én** live-geverifieerd eigendom; auth-forms alleen met wegwerp-account, anders skip + info-finding (geen 500).
- [ ] Géén echte malware/webshell geüpload; canary is onschadelijk; path-traversal wordt gedetecteerd, niet uitgevoerd; probe-set is begrensd + rate-limited.
- [ ] Classificatie-ladder levert `high` bij aantoonbaar uitvoerbare/opvraagbare upload, met request/response-evidence; findings `active:true`, niet in overall-score.
- [ ] Canary wordt opgeruimd waar mogelijk; anders expliciet gemeld in de finding.
- [ ] Pure `classifyUploadOutcome` is unit-getest op alle uitkomsten; geen echte uploads in de tests.
