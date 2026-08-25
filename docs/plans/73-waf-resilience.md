# Plan: WAF/CDN-weerbaarheid & API-rate-limit-inspectie (G7)

**Doel**: Beoordeel of een site achter een WAF/CDN staat en of API-rate-limiting
zichtbaar is — CheckVibe's "WAF/CDN & DDoS-weerbaarheid" + "API Rate Limiting
Inspection" gecombineerd. **Passief + opt-in burst** (scope bevrozen op
2026-08-23): een altijd-lopende passieve fingerprint/header-inspectie op de
bestaande fetch, plus een begrensde burst achter opt-in + Pro om 429-gedrag te
observeren. **Geen load-generatie zonder eigendomsbewijs** — de burst is klein
(6 snelle sequentiële GET's op de scan-URL zelf, niet op API-endpoints) en erft
de gating van plan 52 (`active: true` + opt-in + Pro).

**Status**: ✅ Geïmplementeerd. Feature 73. Dekt gap G7 uit
`docs/gap-analysis-checkvibe-security-checks.md`.

## Besluiten

1. **Twee catalog-entries**, één passief + één actief:
   - `waf-resilience` (categorie `http`, `active: false`) — altijd aan. Passief:
     WAF/CDN-fingerprint + rate-limit-header-inspectie op de bestaande homepage-
     fetch. Geen extra request.
   - `rate-limit-burst` (categorie `http`, `active: true`) — opt-in + Pro. Eén
     begrensde burst (6 snelle sequentiële GET's op de scan-URL) om 429/rate-limit-
     gedrag te observeren. Wordt geproduceerd door de `active-tests`-implementatie
     (test #12), net als de andere actieve tests — erft zo de gating, rate-limit
     en skeletonTotals-special-case van plan 52.
2. **WAF/CDN-fingerprint** (passief, hergebruikt response-headers): herkent
   Cloudflare (`cf-ray`, `server: cloudflare`), AWS WAF/CloudFront
   (`x-amzn-trace-id`, `x-aws-waf-token`, `x-amz-cf-id`), Akamai
   (`x-akamai-transformed`, `akamai-grn`), Sucuri (`x-sucuri-id`), Imperva
   (`x-incap-ses`, `server: imperva`), Fastly (`x-served-by: cache-*`, `x-timer`),
   Vercel/Netlify (overgenomen signalen), plus een generieke `x-cdn`/`x-firewall`.
   Dit overlapt bewust met plan 69 (hosting-fingerprint) voor platform-detectie,
   maar beoordeelt **andere** signalen (WAF-aanwezigheid + rate-limit, niet
   cache-hygiëne/origin-lek/preview-URL) — geen dubbele findings.
3. **Rate-limit-header-inspectie** (passief): leest `x-ratelimit-limit`,
   `x-ratelimit-remaining`, `x-ratelimit-reset`, `ratelimit-*` (zonder koppelteken),
   `retry-after`. Aanwezigheid = positief signaal (info); afwezigheid gecombineerd
   met géén WAF/CDN = `low` (API kan rate-limiting missen).
4. **429 op de bestaande fetch** = `info` (rate-limiting werkt, al actief bij één
   request — mogelijk agressief, maar geen straf).
5. **Burst-gedrag** (actief, opt-in): 6 snelle sequentiële GET's op `ctx.url` via
   `probeGet` (met de bestaande per-host Redis rate-limit). Observeert: 429-status,
   `retry-after`, en of `x-ratelimit-remaining` daalt.
   - `pass` — rate-limiting trad in (429 óf `retry-after` verscheen óf remaining
     bereikte 0).
   - `warn` — geen rate-limiting waargenomen onder de burst (alles 200, geen 429,
     geen rate-limit-headers).
   - `info` — burst onvolledig (eigen rate-limiter uitgeput of fetch-fouten).
6. **Geen load-generatie tegen API-endpoints van derden.** De burst raakt
   uitsluitend de scan-URL zelf (de homepage), niet gegiste API-padenn. Geen
   DDoS-simulatie, geen hoge concurrency — sequentiëel, 6 requests, achter opt-in.
7. **Geen valse stelligheid**: "geen WAF/CDN of rate-limit-headers gedetecteerd"
   ≠ "de site is onbeschermd" — een WAF kan op netwerklaag zitten zonder headers
   te lekken. De finding is een observatie, geen uitspraak over weerbaarheid.

## Uitgangssituatie (code vandaag)

- `apps/worker/src/checks/http/active-tests.ts` (plan 52) — produceert alle
  `active: true` catalog-entries via `activeTestCatalogIds`; test #12 is een
  natuurlijke uitbreiding. `probeGet` al met per-host rate-limit + timeout.
- `apps/worker/src/checks/http/hosting-fingerprint.ts` (plan 69) — fingerprint
  platform uit headers, maar beoordeelt cache-hygiëne/origin-lek/preview, niet
  WAF-aanwezigheid of rate-limit. Geen overlap in beoordeling.
- `apps/worker/src/checks/types.ts` — `fetchPage` (SSRF-guard, byte-cap,
  redirect-follow) en `CheckContext.fetchPage` (gememoïseerde gedeelde fetch).
- Geen WAF- of rate-limit-velden in catalog of DB.

## Contract / DB / API

- **Shared**: `packages/shared/src/waf-resilience.ts`:
  - `WafCdnFingerprint` — `{ waf: string | null, cdn: string | null, signals: string[] }`.
  - `RateLimitHeaders` — `{ headers_found: string[], retry_after: string | null }`.
  - `detectWafCdn(headers)` (puur), `inspectRateLimitHeaders(headers)` (puur),
    `evaluateWafResilience(fp, rl, status429)` → `{ status, detail, severity }` (puur).
  - `wafResilienceEvidence(fp, rl)` — evidence-object voor de finding.
- **Catalog**: `waf-resilience` (active: false) + `rate-limit-burst` (active: true)
  in `check-catalog.ts`.
- **Findings**: `waf-resilience` → één site-level finding (passief). `rate-limit-burst`
  → één actieve finding (opt-in), `active: true`, telt niet mee in de score.
- **Fix-prompts**: `waf-resilience` + `rate-limit-burst` in `fix-prompt.ts`.
- **UI**: findings-lijst (HTTP). Geen aparte pagina.

## Stappen

1. `packages/shared/src/waf-resilience.ts`: pure helpers + schema's + evaluatie.
2. `packages/shared/src/index.ts`: export toevoegen.
3. `packages/shared/src/fix-prompt.ts`: twee templates toevoegen.
4. `packages/shared/src/check-catalog.ts`: twee entries toevoegen.
5. `apps/worker/src/checks/http/waf-resilience.ts`: passieve check (hergebruikt
   `ctx.fetchPage ?? fetchPage`).
6. `apps/worker/src/checks/http/active-tests.ts`: test #12 `rate-limit-burst`.
7. `apps/worker/src/checks/registry.ts`: `wafResilienceCheck` registreren
   (`rate-limit-burst` wordt auto-geclaimd door `activeTestCatalogIds`).
8. Tests: pure helpers (shared) + check-run (worker, mock fetch) + burst (mock
   probeGet).

## Acceptatiecriteria

- [ ] `waf-resilience` levert `info` bij WAF/CDN-detectie of rate-limit-headers,
      `low` bij afwezigheid van beide, `info` bij 429 op de bestaande fetch.
- [ ] `rate-limit-burst` levert `pass` bij 429/retry-after/remaining-0, `warn` bij
      geen rate-limiting onder de burst, `info` bij onvolledige burst.
- [ ] Passieve check hergebruikt de bestaande fetch (geen extra request); burst
      is sequentieel, max 6 GET's, alleen op de scan-URL, achter opt-in + Pro.
- [ ] Geen dubbele findings met plan 69 (andere signalen).
- [ ] Pure helpers (`detectWafCdn`, `inspectRateLimitHeaders`,
      `evaluateWafResilience`) zijn unit-getest op header-fixtures.
