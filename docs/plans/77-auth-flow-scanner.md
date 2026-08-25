# Plan: Authentication Flow Scanner (login / signup / password-reset)

**Doel**: De login-, signup- en wachtwoord-reset-flows van een geverifieerde eigen site beoordelen op veelvoorkomende zwaktes — zoals CheckVibe's "Authentication Flow Scanner". Dit is gap **G9** en de gevaarlijkste check van de hele catalog: hij raakt authenticatie-endpoints die accounts kunnen aanmaken, mail versturen en gebruikers op slot kunnen zetten. Daarom draait hij als **actieve, veilige subset** achter driedubbele gating: opt-in + Pro (plan 52) **én** bewezen domeineigendom (plan 76) **én** een door de gebruiker geleverd wegwerp-testaccount.

**Status**: 📝 Plan klaar (niet gestart). Feature 77. Voorwaarden: plan 52 (actieve-test-gating, klaar) + plan 76 (eigendom-verificatie).

## Besluiten

1. **Agressiviteit: actieve, veilige subset** (bewust géén volledige signup/lockout-tests). We doen alleen actieve probes die niemand schaden en die geen blijvende accounts aanmaken of echte gebruikers uitsluiten. Expliciet **niet**: echte accounts aanmaken, mail-storms, brute-force, of het op slot zetten van accounts die niet het wegwerp-testaccount zijn.
2. **Driedubbele gating** (skip-met-info-finding als één ontbreekt, nooit een fout):
   - `active: true` + opt-in + Pro-plan (erft plan 52).
   - **Domeineigendom live geverifieerd** via `verifyOwnershipLive(siteId)` (plan 76) op het moment van dispatch.
   - **Wegwerp-testaccount aanwezig** (encrypted opgeslagen, plan 52-credentialpatroon).
3. **Draait in de browser-worker** (Playwright): auth-flows vereisen echte form-interactie en DOM-observatie. Herbruikt `apps/worker/src/checks/browser/playwright-runner.ts` (`newContext`/`page`, zoals browser-storage plan 70).
4. **Checkset (veilige subset)** — één implementatie produceert een kleine set catalog-ids (patroon zoals security-headers):
   - `auth-transport` — login/signup/reset-pagina's over HTTPS? password-veld met `autocomplete`-hygiëne? *(passief)*
   - `auth-csrf` — CSRF-token aanwezig op de auth-formulieren? *(passief)*
   - `auth-user-enumeration` — reset-flow met een bekend-onbestaand e-mailadres vs. het wegwerp-account: verschilt de respons/timing zó dat de site lekt wélke e-mails bestaan? *(actief, onschadelijk)*
   - `auth-rate-limit` — begrensde burst (≤5) foute wachtwoorden **alleen tegen het eigen wegwerp-account**: grijpt rate-limiting/lockout in? *(actief, begrensd; raakt nooit een ander account)*
   - `auth-password-policy` — accepteert het signup-/reset-formulier een triviaal zwak wachtwoord (`123456`) op validatieniveau, **zonder de registratie af te ronden**? *(actief, geen account-creatie)*
   - `auth-session-security` — na login met het wegwerp-account: `Secure`/`HttpOnly`/`SameSite` op de sessiecookie, en roteert het sessie-id ná login (session-fixation)? *(actief, eigen account)*
   - `auth-mfa` — is MFA beschikbaar/afgedwongen na login? *(best-effort, info)*
5. **Niet-destructief & begrensd** (erft plan 52 besluit 2/4): vaste kleine payload-set, timeout per probe, per-host Redis-rate-limit (verplicht uit AGENTS.md). De rate-limit-probe is hard begrensd zodat zelfs het wegwerp-account niet blijvend op slot gaat (of: geaccepteerd als bewijs zodra lockout intreedt, dan direct stoppen).
6. **Aparte score-behandeling** (plan 52 besluit 3): findings krijgen `active: true`, verschijnen in de "Active tests"-sectie en tellen **niet** mee in de overall-score.
7. **Geen valse stelligheid**: bevindingen beschrijven waargenomen gedrag ("reset-respons verschilt voor bestaande vs. onbestaande e-mail → user-enumeration mogelijk"), geen absolute claims. Evidence = request/response (afgekapt ~4KB, plan 52 besluit 6).

## Uitgangssituatie (code vandaag)

- Plan 52 (klaar): `active_tests`-flag op `POST /api/scans`, Pro-gate, `active-tests`-check + registry-fan-out, encrypted credential-opslag-patroon (tenant-isolation, besluit 5), evidence-schema, `active: true`-filter.
- Plan 76 (voorwaarde): `verifyOwnershipLive(siteId)` + `ownership_verified_at`.
- `browser/playwright-runner.ts` + `createBrowserStorageCheck` (plan 70) als voorbeeld van een browser-worker-check met `newContext`.
- Geen auth-flow-check in de catalog (geverifieerd: geen `auth-*`-id aanwezig).

## Contract / DB / API

- **Catalog** (categorie `http` voor consistentie met de active-test-sectie, maar de implementatie draait in de browser-queue; of categorie `aeo`/browser zoals plan 70 — bij bouw afstemmen): de zeven `auth-*`-ids uit besluit 4, allemaal `active: true`.
- **Credentials**: hergebruik de encrypted credential-opslag van plan 52 (tenant-isolation) — per site een wegwerp-testaccount `{ login_url?, username/email, password }`. Zonder credentials → skip + info-finding.
- **Dispatch/gating** (plan 27 + 52): auth-flow-jobs alleen fannen als `active_tests` staat **én** `verifyOwnershipLive` true teruggeeft **én** credentials aanwezig zijn.
- **Findings**: `active: true`, `evidence:{request,response}`, severity per besluit 4; niet in overall-score.
- **UI**: erft de plan 52 "Actieve tests (Pro)"-toggle; extra: een blokkerende hint "Verifieer eerst domeineigendom" (link naar plan 76-kaart) + een veld voor het wegwerp-testaccount. Resultaten in de bestaande active-tests-sectie.

## Stappen

1. Catalog: de zeven `auth-*`-ids (`active:true`) + registratie in de browser-queue van `apps/worker/src/checks/registry.ts`.
2. Gating-laag: dispatch skipt de auth-flow tenzij `active_tests` + `verifyOwnershipLive(siteId)` + credentials; anders info-finding.
3. Auth-form-discovery (Playwright): login/signup/reset-formulieren vinden (herbruik crawl-hints uit plan 54 + DOM-scan).
4. Passieve sub-checks eerst (goedkoop): `auth-transport`, `auth-csrf`.
5. Veilige actieve sub-checks: `auth-user-enumeration` (reset met onbestaand vs. wegwerp-mail), `auth-rate-limit` (begrensde burst tegen eigen account, stopt bij lockout), `auth-password-policy` (zwak-wachtwoord-validatie zonder afronden), `auth-session-security` (cookie-flags + session-id-rotatie na login), `auth-mfa` (best-effort observatie).
6. Fix-prompt-tekst (plan 60): per bevinding concrete remediatie (uniforme reset-respons, lockout/backoff, `Secure;HttpOnly;SameSite`, MFA aanzetten).
7. Tests: gating (geen ownership → skip; geen creds → skip; niet-Pro → 403), begrensdheid van de rate-limit-burst, non-destructiviteit (geen blijvend account, geen mail-storm), user-enumeration-detectie op mock-responses, session-fixation-detectie, evidence-afkapping.

## Open vragen

- **Rate-limit-probe zonder het wegwerp-account te verbranden**: 5 pogingen kan het testaccount al locken. → *Voorstel*: burst stopt zodra rate-limiting/lockout waarneembaar is (dat ís het positieve bewijs); als er nooit iets intreedt, is dat de finding. Nooit tegen een ander account dan het wegwerp-account.
- **Signup zonder account aan te maken**: veel signups ronden direct af. Kunnen we betrouwbaar bij client-side/serverside-validatie stoppen vóór creatie? → *Voorstel*: `auth-password-policy` beperkt zich tot de validatie-respons; als de flow niet zonder creatie te testen is, degradeert de check naar info i.p.v. een echt account aan te maken.
- **Categorie/queue-consistentie**: browser-worker-check met `http`-categorie (voor de active-tests-sectie) vs. een aparte categorie — bij bouw afstemmen met de progress-skelet-telling (plan 27).
- **Reset-mail naar het wegwerp-account**: user-enumeration triggert mogelijk een echte reset-mail naar het wegwerp-adres. Dat is acceptabel (eigen adres), maar noteren zodat het niet als "mail-storm" leest.

## Acceptatiecriteria

- [ ] Auth-flow-scan draait alleen met `active_tests:true` + Pro **én** live-geverifieerd domeineigendom **én** aanwezig wegwerp-testaccount; elke ontbrekende voorwaarde → skip + info-finding (geen fout, geen 500).
- [ ] Géén blijvend account aangemaakt op de doelsite; geen mail-storm; de rate-limit-burst raakt uitsluitend het wegwerp-account en is hard begrensd.
- [ ] `auth-user-enumeration` en `auth-session-security` leveren findings met request/response-evidence; findings hebben `active:true` en tellen niet mee in de overall-score.
- [ ] Per-host rate-limit + timeout per probe actief (AGENTS.md-eis).
- [ ] UI blokkeert de scan met een duidelijke "verifieer eerst eigendom"-hint als plan 76 niet voldaan is.
- [ ] Pure detectie-helpers (enumeration-vergelijking, session-id-rotatie) zijn unit-getest op mock-responses; geen echte auth-calls in de tests.
