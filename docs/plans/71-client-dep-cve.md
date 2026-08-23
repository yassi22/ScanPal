# Plan: Client-side dependency & CVE-scanner ("Tech Stack & CVE")

**Doel**: Detecteer client-side JS-libraries + versies uit de geladen pagina en match ze tegen bekende CVE's via OSV — CheckVibe's "Tech Stack & CVE Scanner". Lost meteen een blinde vlek op: `osv-scanner` draait vandaag **alleen** met een gekoppelde GitHub-repo, dus **URL-only sites hebben nu nul dependency-dekking**.

**Status**: ✅ Geïmplementeerd (v1 statisch + v2 runtime). Feature 71.

## Besluiten

1. **Nieuwe catalog-check `client-deps-cve`** (categorie `http`), passief. Werkt op URL-only sites (geen repo nodig) en vult zo het gat dat `osv-scanner` (github-queue) laat vallen.
2. **Detectiebron** (best-effort, geleidelijk):
   - **v1 — statisch**: parse de al-gefetchte HTML op `<script src>`-URL's en herken versies uit bekende CDN-/bundle-patronen (`/jquery@3.4.1/`, `react.production.min.js` + versie-comment, `bootstrap@…`, `/npm/<pkg>@<version>/`). Plus generator-/framework-markers die `stack-detection` al vindt.
   - **v2 — runtime (optioneel, browser-queue)**: lees `window`-globals (`window.jQuery.fn.jquery`, `window.React.version`, `window.angular.version.full`) via de Playwright-runner (hergebruik plan 70's page). Hardere versiebewijzen dan URL-parsing.
3. **CVE-matching**: hergebruik de OSV-lookup uit `osv-scanner` (`apps/worker/src/checks/github/osv-scanner.ts`) — refactor de OSV-query naar een gedeelde helper (`packages/shared` of scan-core) die zowel de github-check als deze check gebruikt. Query per `(ecosystem: npm, package, version)`.
4. **Finding-regels**:
   - severity spiegelt de OSV/CVSS-severity van de match (`critical`/`high`/`medium`/`low`).
   - alleen een finding bij een **versie-bevestigde** match; versie onbekend → info-finding "lib gedetecteerd, versie onbevestigd" (geen straf, geen valse CVE-claim).
5. **Geen valse stelligheid**: "gedetecteerde versie" is een client-side observatie; de check zegt niet dat de kwetsbaarheid exploiteerbaar is, alleen dat een kwetsbare versie geladen wordt.

## Uitgangssituatie (code vandaag)

- `apps/worker/src/checks/github/osv-scanner.ts` (feature 48) — draait OSV **alleen** in de github-queue, op een gekoppelde repo. Bevat de OSV-query-logica.
- `apps/worker/src/checks/http/stack-detection.ts` (feature 40) — detecteert CMS/framework/server maar **doet geen CVE-lookup en geen versies** (geverifieerd: geen `cve`/`version` in dat bestand).
- `packages/shared/src/bundle-secrets.ts` + `secrets-in-bundles` fetchen al client-bundles → infra om script-URL's/bundles te lezen bestaat.

## Contract / DB / API

- **Shared**: `detectedDependencySchema` — `{ package, ecosystem: "npm", version: string|null, source: "cdn-url"|"bundle"|"runtime-global"|"generator", vulns: OsvVuln[] }`; gedeelde `queryOsv(pkg, version)`-helper.
- **Catalog**: `{ id: "client-deps-cve", category: "http", name: "Client-side dependencies & CVE", active: false }`, registreren in `registry.ts`. (v2-runtime-variant kan later een aparte aeo-entry worden of in plan 70's run meeliften.)
- **Findings**: severity uit OSV; evidence = gedetecteerde lib+versie+bron + CVE-id's/links.
- **UI**: findings-lijst (HTTP). Overlapt qua vorm met de repo-dep-findings van `osv-scanner`; markeer de bron ("client-side" vs "repo") zodat ze niet samenvallen.

## Stappen

1. Refactor: OSV-query uit `osv-scanner.ts` naar een gedeelde `queryOsv`-helper (met de bestaande tests mee-migreren); `osv-scanner` blijft functioneel identiek.
2. Pure `detectClientDeps(html, scriptUrls)`-helper: CDN-URL-patronen + generator-markers → `{package, version, source}`; unit-tests op fixtures.
3. Catalog-entry + registratie; `client-deps-cve`-check die detectie + `queryOsv` combineert en findings emit; versie-onbekend → info.
4. (v2, optioneel) runtime-globals via de browser-runner (plan 70-page) voor hardere versies.
5. Fix-prompt (plan 60): "upgrade `<pkg>` naar `<fixed-version>`"; link naar het OSV/GHSA-advies.
6. Tests: bekende kwetsbare CDN-URL → CVE-match, onbekende versie → info, geen dubbele finding met repo-`osv-scanner`.

## Open vragen

- Hoe breed de CDN-/versie-patroonlijst in v1? → *Voorstel*: start met de meest voorkomende (jQuery, Bootstrap, React, Vue, Angular, lodash, Moment) + de generieke `/npm/<pkg>@<ver>/`- en `/<pkg>@<ver>/`-jsDelivr/unpkg-patronen; breid uit op basis van echte scans.
- OSV-ratelimit/caching: per-scan veel lookups. → *Voorstel*: batch OSV-`querybatch`-endpoint + korte Redis-cache per `(pkg,version)`.

## Acceptatiecriteria

- [ ] `client-deps-cve` levert CVE-findings voor kwetsbare client-side libs op een **URL-only** site (geen repo).
- [ ] OSV-query is gedeeld met `osv-scanner`; die check blijft ongewijzigd van gedrag.
- [ ] Versie onbevestigd → info-finding, geen valse CVE-claim; client-side findings botsen niet met repo-dep-findings.
- [ ] Detectie- en OSV-helpers zijn puur/gemockt en unit-getest.
