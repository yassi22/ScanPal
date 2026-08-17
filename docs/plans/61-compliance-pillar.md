# Plan: Compliance-pijler (privacy, cookie-consent, GDPR-signalen)

**Doel**: Een eigen compliance-check-set op de live site — cookie-banner/CMP-detectie (OneTrust, Cookiebot, Usercentrics, …), consent-API, privacy-policy-pagina, terms/imprint, GDPR-signalen (DSAR, verwijderingsverwijzing) — als nieuwe score-categorie naast security/SEO/AEO (CheckVibe's "Compliance: cookies, privacy and legal signals"). Bevindingen zijn signalen met uitleg, geen juridische oordelen.

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-16)

1. **Nieuwe categorie `compliance`**: het progress-enum uit plan 06 (`http | seo | aeo | github`) wordt uitgebreid → contractwijziging in `packages/shared` (progress-schema's, categorie-labels, scoring)
2. **Passief**: de checks kruipen + analyseren HTML/DOM alleen; er worden **geen** cookies geplaatst (geen interactie met de banner)
3. **Check-set** (catalog, categorie `compliance`, http-worker/SEO-worker):

| id | naam | wat |
|---|---|---|
| cookie-banner | Cookie-banner/CMP detectie | herkenning van bekende CMP's (script-klassen/ids), banner-element, consent-modus |
| consent-api | Consent-API | `__tcfapi` / `googlefc` / `CMP` globals aanwezig, consent-verklaring in DOM |
| privacy-policy | Privacy-policy | pagina gelinkt vanuit footer (terms-links), last-updated-datum, contact-e-mail |
| legal-pages | Legal-pagina's | terms/imprint/contact-verwijzingen in footer |
| gdpr-signals | GDPR-signalen | DSAR/data-verwijdering-verwijzing, IAB-TCF/CMP-signalen |

4. **Geen juridische claims**: finding-teksten zijn observaties ("geen privacy-policy-link gevonden in footer") met uitleg + disclaimer-lijn in het rapport (plan 10); dit is geen legal-advies
5. **Score**: compliance telt mee in de overall-score met een ondersteunend gewicht (afstemmen in de aggregatie; voorstel: 10% — naast http/seo/aeo/github)
6. First pass: GDPR-signalen (EU-centrisch); CCPA/regionale varianten expliciet later

## Uitgangssituatie (code vandaag)

- Cookie-security-audit (29) bestaat in MVP maar vanuit security-perspectief (HttpOnly/SameSite) — niet als consent/compliance
- Meta/SEO-checks (35), mini-crawler (38) en footer/404-check (37) leveren de link-basis
- Progress-enum + catalog (plan 06) zonder `compliance`; resultatenpagina kent 4 categorie-kaarten

## Contract / DB / API

- `packages/shared`: progress-enum uitbreiden met `compliance` (categoryLabels + categoryProgress), catalog-entries hierboven, `complianceSignalsSchema` (per check een `{ signal, detail }`-object)
- Findings JSONB conform het versioned-schema (plan 09); scores: `scans.scores`-structuur (plan 08) krijgt `compliance`
- UI: vijfde categorie-kaart op resultatenpagina (label "Compliance & privacy"), filter op categorie

## Stappen

1. Shared: enum-uitbreiding + catalog-entries + schema's + tests (geen check zonder catalog-entry)
2. http-worker-checks: cookie-banner (CMP-lijst als constante in shared), consent-api (DOM-globals), privacy-policy (footer-link-crawl + last-updated-parse), legal-pages, gdpr-signals
3. Aggregatie: compliance-score + gewicht in overall; resultaatweergave
4. UI: categorie-kaart + finding-details ("waarom is dit een signaal" + disclaimer)
5. Export (plan 10): compliance-sectie + disclaimer-regel
6. Tests: CMP-detectie (mock-DOM/HTML-fixtures), footer-link-herkenning, last-updated-parse, score-gewicht

## Open vragen

- CMP-lijst: welke 10–20 leveranciers in v1 (OneTrust, Cookiebot, Usercentrics, Axeptio, …) — en hoe blijft die lijst actueel (catalog-versie-beheer)?
- Meertalige sites: privacy-policy herkennen op alleen naam-kernwoorden (privacy/cookie/legal) — hoeveel taal-varianten?
- Score-gewicht: compliance standaard in overall of apart (vergelijkbaar met actieve tests 52)? — voorstel: 10% in overall, want het is een "pijler" zoals bij CheckVibe

## Acceptatiecriteria

- [ ] Vijf compliance-checks draaien passief; geen cookies worden geplaatst
- [ ] Nieuwe categorie `compliance` werkt door in progress, scoring en resultaten-UI
- [ ] Bekende CMP's worden herkend (fixtures per leverancier); privacy-policy/legal-links uit de footer gevonden
- [ ] Bevindingen bevatten uitleg + disclaimer; geen juridische claims
- [ ] Compliance-score telt mee in overall (gewicht) en in het export-rapport
