# Plan: Domein-eigendom-verificatie (DNS TXT)

**Doel**: Een herbruikbare flow waarmee een gebruiker bewijst dat hij eigenaar is van een gescand domein, via een DNS TXT-record. Dit is de poort voor hoog-risico acties die je niet op andermans domein mag uitvoeren — in de eerste plaats de Authentication Flow Scanner (G9, plan 77), maar ook toekomstige eigendom-gated features (bv. actievere WAF-burst uit plan 73/G7). Losstaand plan zodat de verificatie niet aan één scanner vastzit.

**Status**: 📝 Plan klaar (niet gestart). Feature 76. Voorwaarde voor plan 77 (G9).

## Besluiten

1. **Methode: DNS TXT-record** (gekozen boven well-known bestand). Per site genereren we een geheim token; de gebruiker zet een TXT-record `scanpal-verify=<token>` op de **apex** van het domein (industriestandaard, zoals Google Search Console). Herbruikt de bestaande swappable `dnsResolver` (`resolveTxt`) uit `packages/scan-core/src/domain-net.ts` — geen nieuwe transport-laag.
2. **Token = geheim, per site, roteerbaar.** Willekeurig gegenereerd (bv. 32 bytes base32), opgeslagen op de site-rij. Rotatie mogelijk (nieuw token invalideert de oude), zodat een gecompromitteerd of gedeeld token ingetrokken kan worden.
3. **Twee verificatiemomenten**:
   - **On-demand** (`POST /api/sites/:id/verify-ownership`): gebruiker klikt "Verifieer", we bevragen live het TXT-record, zetten bij succes `ownership_verified_at`.
   - **Live her-check vlak vóór een hoog-risico scan** (`verifyOwnershipLive(siteId)`): het TXT-record wordt opnieuw bevraagd op het moment van dispatch. Reden: een domein kan van eigenaar wisselen tussen "ooit geverifieerd" en "nu scannen". Hoog-risico scans (G9) vertrouwen dus nooit blind op een oude `verified_at`.
4. **Eigendom kan verlopen.** `ownership_verified_at` heeft een geldigheidsvenster (voorstel 30 dagen) voor de UI-badge; de live her-check (besluit 3) is de harde gate voor actieve scans, niet de badge.
5. **Geen valse stelligheid / privacy**: het token staat publiek in DNS maar bewijst alleen controle over de DNS-zone; we behandelen het als een geheim in logs/UI (niet volledig in URL's, conform de projectregels).

## Uitgangssituatie (code vandaag)

- `packages/scan-core/src/domain-net.ts` — swappable `dnsResolver` met `resolveTxt` (al gebruikt door `dns-email`, plan 68).
- `sites`-tabel (plan 04) bestaat; **geen** `ownership_*`-kolommen, geen verify-endpoint, geen `sites.verified` (geverifieerd: niet aanwezig).
- Bestaande GitHub-repo-koppeling bewijst wél enige controle, maar dekt geen URL-only sites → daarom DNS TXT als universele methode.

## Contract / DB / API

- **DB-migratie** (nummer bij merge afstemmen): op `sites` toevoegen:
  - `ownership_token text` (gegenereerd bij site-aanmaak of eerste verify-poging)
  - `ownership_verified_at timestamptz null`
  - `ownership_method text null` (nu alleen `"dns-txt"`; kolom laat latere methodes toe)
- **API**:
  - `GET /api/sites/:id/ownership` → `{ token, record_name, record_value: "scanpal-verify=<token>", verified_at }` (instructies voor de gebruiker).
  - `POST /api/sites/:id/verify-ownership` → bevraagt live TXT; `200 {verified:true, verified_at}` of `200 {verified:false, reason}`. Rate-limit per site (hergebruik Redis-limiter) tegen hameren.
  - Helper (intern, niet publiek): `verifyOwnershipLive(siteId, deps): Promise<boolean>` — herbruikt door plan 77's dispatch-gate.
- **Shared**: `ownershipSchema` + pure `matchesOwnershipTxt(records, token)` (parse van TXT-records, tolereert quotes/whitespace/meerdere records). Unit-getest op mock-resolver.
- **UI**: op de site-detailpagina een "Eigendom verifiëren"-kaart: toont `record_name`/`record_value` om te kopiëren, een "Verifieer nu"-knop en een status-badge (Geverifieerd / Niet geverifieerd / Verlopen).

## Stappen

1. Migratie: `ownership_token`/`ownership_verified_at`/`ownership_method` op `sites`; token genereren bij site-aanmaak (backfill bestaande sites lazily bij eerste `GET /ownership`).
2. `packages/shared`: `ownershipSchema` + pure `matchesOwnershipTxt(records, token)` + tests.
3. `packages/scan-core`: `verifyOwnershipLive(siteId, deps)` die `resolveTxt(apexPunycode)` doet en `matchesOwnershipTxt` toepast.
4. API: `GET /ownership` + `POST /verify-ownership` (met per-site rate-limit); schrijft `ownership_verified_at`.
5. UI: verificatie-kaart op site-detail met kopieerbare record-instructies + status-badge.
6. Tests: token-match (quotes, meerdere TXT-records, apex vs subdomein), niet-gevonden → verified:false, rotatie invalideert oud token, rate-limit op de verify-endpoint, IDN→punycode.

## Open vragen

- **Record-naam: apex (`example.com`) of subdomein (`_scanpal-verify.example.com`)?** → *Voorstel*: apex TXT (`scanpal-verify=<token>`), meest herkenbaar; subdomein-variant later toevoegen als gebruikers apex-TXT-clutter willen vermijden.
- **Token genereren bij site-aanmaak of pas bij eerste verify-poging?** → *Voorstel*: lazy bij eerste `GET /ownership` (geen migratie-backfill-storm), deterministisch daarna.
- **Geldigheidsvenster van de badge**: 30 dagen redelijk? De harde gate is toch de live her-check. → *Voorstel*: 30 dagen, config-baar.

## Acceptatiecriteria

- [ ] Gebruiker kan per site een token ophalen, een TXT-record zetten en via "Verifieer nu" de eigendom bevestigen; status-badge weerspiegelt de uitkomst.
- [ ] `verifyOwnershipLive(siteId)` bevraagt live DNS en is herbruikbaar als harde gate door andere plannen (plan 77).
- [ ] Token-rotatie invalideert het oude record; verify faalt dan tot het nieuwe record staat.
- [ ] `verify-ownership` is per-site rate-limited; token wordt niet in URL's/logs gelekt.
- [ ] Pure `matchesOwnershipTxt` is unit-getest op quote-/meervoud-/whitespace-varianten; geen echte DNS-calls in tests.
