# Plan: Observability-signalen (extern-zichtbare monitoring — G11 herdefinieerd)

**Doel**: Gap **G11** ("Audit Logging & Monitoring") is in de gap-analyse bewust geparkeerd omdat je andermans logging **niet van buitenaf kunt observeren** — een echte black-box "audit-logging-scanner" zou verzonnen zijn. Dit plan herdefinieert G11 tot wat black-box wél eerlijk meetbaar is: **extern-zichtbare observability-signalen** als *indirecte* aanwijzing dat een site foutrapportage/monitoring heeft ingericht. Passief, default-aan. Het is uitdrukkelijk **geen** bewijs dat auth-events gelogd of bewaard worden.

**Status**: 📝 Plan klaar (niet gestart). Feature 79. Vervangt de "needs-definition"-parkeerstatus van G11 door een strak afgebakende passieve check.

## Besluiten

1. **Passieve check `observability-signals`** (categorie `http`), default-aan, geen `active`-gating. Herbruikt de bestaande homepage-fetch + response-headers (zoals `hosting-security`/`stack-detection`) en optioneel de JS/HTML-scan; raakt de doelsite niet.
2. **Alleen extern-zichtbare signalen** (geen enkele claim over interne logging):
   - **Reporting-headers**: CSP `report-uri`/`report-to`-directive, losse `Report-To`-header, en `NEL` (Network Error Logging) — bewijzen dat de site client-side fouten láát rapporteren.
   - **Error-tracking/RUM-beacons** in HTML/JS: Sentry, Datadog RUM, LogRocket, Bugsnag, New Relic Browser, Rollbar e.d. — gedetecteerd uit script-URL's/globals (zelfde patroon als `stack-detection` en de bundle-scan).
   - **security.txt**: aanwezig `Contact`/rapportagekanaal (herbruikt de `security-txt`-check als signaal, telt niet dubbel).
3. **Severity: informatief, nooit een harde straf.** Dit is het kernbesluit dat G11 eerlijk houdt:
   - `info`/pass — één of meer observability-signalen gedetecteerd ("site rapporteert client-side fouten via X").
   - `low`/info — géén extern-zichtbare signalen. **Uitdrukkelijk geen `medium`/`high`**, want afwezigheid bewijst niets: server-side audit-logging is per definitie onzichtbaar van buitenaf.
   - Weegt niet (of hooguit minimaal) mee in de overall-score, zodat sites zonder client-side telemetrie niet onterecht gestraft worden.
4. **Geen valse stelligheid (verplicht)**: de negatieve finding zegt letterlijk *"geen extern-zichtbare monitoring-signalen gedetecteerd — dit bewijst NIET dat er geen audit-logging is; server-side logging is van buitenaf onzichtbaar."* Precies de zorg uit de gap-analyse, in de findingtekst geadresseerd.
5. **Herbruik, geen nieuwe infra**: detectie leunt op de al bestaande header-parsing en JS-libdetectie; geen nieuwe queue, geen externe API, geen credentials.

## Uitgangssituatie (code vandaag)

- `stack-detection` (plan 40) + bundle-scan detecteren al JS-libs/vendors uit script-URL's — direct uit te breiden met de RUM/error-tracking-vendorlijst.
- `hosting-security` (plan 69) leest al response-headers → `Report-To`/`NEL`/CSP zijn daar goedkoop bij te lezen.
- `security-txt` (plan 37) bestaat al als aparte check → hier alleen als signaal refereren, niet herimplementeren.
- Geen observability-/monitoring-check in de catalog.

## Contract / DB / API

- **Catalog**: entry `{ id: "observability-signals", category: "http", name: "Observability & monitoring-signalen", active: false }` in `check-catalog.ts`, registreren in `registry.ts` (http-queue).
- **Shared**: `observabilitySchema` = `{ reporting_headers: string[], beacons: string[], security_txt: boolean }` + pure `classifyObservability(signals)` → `info` bij ≥1 signaal, anders `low`/info. Vendorlijst als constante.
- **Findings**: severity per besluit 3; evidence = welke signalen/headers/vendors gevonden zijn (of expliciet "geen").
- **DB**: geen nieuwe kolommen nodig; puur finding-output.
- **UI**: verschijnt in de bestaande findings-lijst (categorie HTTP). Geen aparte pagina.

## Stappen

1. Catalog-entry + registratie.
2. `packages/shared`: `observabilitySchema` + RUM/error-tracking-vendorlijst + pure `classifyObservability` + de niet-strafgevende severity-regel; unit-tests.
3. Check-implementatie: lees `Report-To`/`NEL`/CSP-reporting uit de bestaande header-set, detecteer beacons uit script-URL's/HTML, referentie naar `security-txt`-uitkomst; stel de finding samen met de anti-stelligheid-tekst (besluit 4).
4. Fix-prompt-tekst (plan 60): *aanbeveling* (niet-verplicht) om client-side error-reporting + CSP-reporting in te richten; expliciet gelabeld als "goede praktijk", geen kwetsbaarheid.
5. Tests: ≥1 signaal → info; geen signalen → low/info met de juiste disclaimer-tekst; vendordetectie op mock-HTML; geen dubbeltelling met de `security-txt`-check.

## Open vragen

- **Verdient afwezigheid überhaupt een finding, of puur een neutrale info-regel?** → *Voorstel*: één neutrale `info`/`low`-regel met disclaimer; liever dat dan stilte, maar nooit een score-straf.
- **Welke RUM/error-tracking-vendors in de startlijst?** → *Voorstel*: Sentry, Datadog RUM, LogRocket, Bugsnag, New Relic Browser, Rollbar; uitbreidbaar.
- **Meetellen in de overall-score?** → *Voorstel*: niet meetellen (of gewicht ~0); dit is een positief signaal, geen tekortkoming.
- **Latere uitbreiding naar self-attestation** (de compliance-checklist-variant die als alternatief overwogen werd): hoort dan bij de compliance-pijler (plan 61), niet bij deze scan-check. Buiten scope van v1.

## Acceptatiecriteria

- [ ] `observability-signals` detecteert reporting-headers (`Report-To`/`NEL`/CSP-reporting) en bekende RUM/error-tracking-beacons, met de gevonden signalen als evidence.
- [ ] Afwezigheid van signalen levert hooguit `low`/info met een expliciete disclaimer dat dit géén bewijs van ontbrekende audit-logging is; nooit `medium`/`high`.
- [ ] Geen score-straf (of gewicht ~0) voor ontbrekende signalen; geen dubbeltelling met de bestaande `security-txt`-check.
- [ ] Herbruikt bestaande header-parsing/JS-libdetectie; geen nieuwe queue, externe API of credentials.
- [ ] Pure `classifyObservability` is unit-getest, inclusief de niet-strafgevende afwezigheids-tak.
