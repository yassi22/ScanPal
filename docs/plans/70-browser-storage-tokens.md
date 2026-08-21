# Plan: Browser storage & session-token scanner

**Doel**: Detecteer JWT's, session-tokens en secrets in `localStorage`/`sessionStorage` na het laden van de pagina — CheckVibe's "Browser Storage & Session Token Scanner". Uitbreiding van de bestaande Playwright-runner; passief (leest alleen client-side storage, plaatst niets).

**Status**: 📝 Plan klaar (niet gestart). Feature 70.

## Besluiten

1. **Nieuwe catalog-check `browser-storage`** (categorie `aeo`, want browser-queue), passief. Draait mee in de bestaande browser-run — geen aparte page-load.
2. **Meting**: na `page.goto(...)` één `page.evaluate()` die `localStorage` + `sessionStorage` (keys + values) uitleest. Values worden **niet ruw opgeslagen**; ze gaan door de bestaande secret-classificatie (`packages/shared/src/bundle-secrets.ts` — herkent JWT's, Supabase-keys, Google/Firebase-keys, `sk_live_`, etc.) plus een JWT-decode voor `alg`/`exp`/claims.
3. **Finding-regels**:
   - `high` — service-role/secret-key-achtig materiaal in storage (bv. `supabase_service_role`, `sk_live_`, private key).
   - `medium` — JWT met langlopende/afwezige `exp` of gevoelige claims in `localStorage` (persisteert over tabs/sessies, XSS-exfiltreerbaar).
   - `low` — session-token in `localStorage` i.p.v. een `HttpOnly`-cookie (algemeen anti-patroon).
   - `info` — storage aanwezig maar niets gevoeligs herkend.
4. **Privacy**: sla alleen een **gemaskeerde** evidence op (key-naam + type + eerste/laatste tekens), nooit de volledige token-waarde. Consistent met hoe `secrets-in-bundles` evidence maskeert.
5. **Geen interactie**: de scanner klikt/logt niet in; hij leest wat er na een normale load in storage staat.

## Uitgangssituatie (code vandaag)

- `apps/worker/src/checks/browser/playwright-runner.ts` — heeft al `browser.newContext()` → `newPage()` → `page.goto(url, {waitUntil:"networkidle"})` voor CWV, accessibility, console-errors, responsive. Een extra `page.evaluate` na load is triviaal in te haken.
- `packages/shared/src/bundle-secrets.ts` — bevat de secret-classificatie + maskering die `secrets-in-bundles`/`secrets-in-html` gebruiken; direct herbruikbaar op storage-values.
- Catalog kent `console-errors`/`mobile-responsive` als aeo-browser-checks; nog geen storage-check.

## Contract / DB / API

- **Shared**: `browserStorageFindingSchema` — `{ store: "local"|"session", key: string, kind: "jwt"|"secret"|"session-token"|"other", masked: string, jwt?: {alg, exp_present, exp_days} }`.
- **BrowserRunner**: nieuw resultaattype `StorageRunResult` in `browser/runner.ts` (naast `AxeRunResult`/`ConsoleRunResult`/…), gevuld door de runner.
- **Catalog**: `{ id: "browser-storage", category: "aeo", name: "Browser storage & session-tokens", active: false }`, registreren in `registry.ts`.
- **Findings**: severity uit besluit 3; evidence altijd gemaskeerd.
- **UI**: findings-lijst (categorie AEO/browser). Geen aparte pagina.

## Stappen

1. `playwright-runner.ts`: na de bestaande `goto` een `page.evaluate` toevoegen die `{local: {...}, session: {...}}` teruggeeft; nieuw runner-result-type + hook in `runner.ts`.
2. Pure classifier `classifyStorageEntry(key, value)` in `packages/shared` bovenop `bundle-secrets` + een kleine JWT-decode-helper; unit-tests.
3. Catalog-entry + registratie; `browser-storage`-check die het runner-result door de classifier haalt en findings emit.
4. Fix-prompt (plan 60): "verplaats session-token naar HttpOnly+Secure+SameSite-cookie", "geen service-role-key client-side".
5. Tests: JWT met/zonder `exp`, service-role-key, gewone niet-gevoelige keys, maskering (nooit volledige waarde in evidence), lege storage → info.

## Open vragen

- Meten na `networkidle` genoeg, of ook na een korte interactie/scroll (SPA's die pas na route-hydratie in storage schrijven)? → *Voorstel*: v1 leest na `networkidle`; als het te veel mist, hergebruik de wacht-heuristiek uit de CWV-run (2.5s).
- Ook `IndexedDB`? → *Voorstel*: buiten scope v1 (async, complexer); alleen `localStorage`/`sessionStorage`.

## Acceptatiecriteria

- [ ] `browser-storage` levert findings voor JWT's/secrets/session-tokens in storage met **gemaskeerde** evidence.
- [ ] Herbruikt de bestaande Playwright-page (geen tweede page-load) en de bestaande secret-classificatie.
- [ ] Volledige token-waarden verschijnen nergens in findings/DB/logs.
- [ ] Classifier is puur en unit-getest; lege storage → info, geen straf.
