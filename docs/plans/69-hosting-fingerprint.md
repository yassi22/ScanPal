# Plan: Hosting-fingerprint security (Vercel / Netlify / Cloudflare + WAF)

**Doel**: Herken het hosting-/CDN-platform uit response-headers en beoordeel platform-specifieke security-signalen — CheckVibe's "Vercel/Netlify/Cloudflare Security Scanners" gecombineerd tot één fingerprint-check. Passief; geen extra requests bovenop wat `stack-detection` al ophaalt.

**Status**: 📝 Plan klaar (niet gestart). Feature 69.

## Besluiten

1. **Nieuwe catalog-check `hosting-security`** (categorie `http`), passief. Draait op de response die de http-worker al fetcht (geen nieuwe fetch).
2. **Fingerprint-bron**: response-headers die de platforms al lekken:
   - **Vercel**: `x-vercel-id`, `x-vercel-cache`, `server: Vercel`.
   - **Netlify**: `x-nf-request-id`, `server: Netlify`.
   - **Cloudflare**: `cf-ray`, `cf-cache-status`, `server: cloudflare`.
   - **Overig** (herkennen, niet beoordelen): Fastly (`x-served-by`), AWS CloudFront (`x-amz-cf-id`), GitHub Pages.
3. **Beoordeling per platform** (passieve signalen, geen config-toegang):
   - Ontbrekende edge-security-headers die het platform triviaal kan zetten (leunt op de bestaande `security-headers`-check, maar met platform-context in de remediatie: "zet dit in `vercel.json`/`netlify.toml`/Cloudflare Transform Rules").
   - Cache-header-hygiëne: `cache-control: public` op een HTML-document dat eruitziet als geauthenticeerd (heuristisch, low/info).
   - Cloudflare: aanwezig `cf-ray` maar `server` verraadt de origin → mogelijke origin-IP-lek (info).
   - Vercel/Netlify: preview-/branch-deploy-URL publiek bereikbaar wanneer die als scan-target is opgegeven (info).
4. **Geen actieve tests, geen vendor-API's, geen auth.** Dit is fingerprint + header-hygiëne met platform-context. De diepere config-audit (Supabase/Firebase-rules) valt onder de aparte gap G5 (plan 72), niet hier.
5. **Stille check bij onbekend platform**: geen platform herkend → één info-finding met de gedetecteerde server-string, geen straf.

## Uitgangssituatie (code vandaag)

- `apps/worker/src/checks/http/stack-detection.ts` (feature 40) leest `Server`/`X-Powered-By`/generator-meta uit dezelfde response — het fetch-resultaat en header-map zijn dus al beschikbaar in de http-worker.
- `security-headers.ts` (feature 28) beoordeelt CSP/HSTS/etc. generiek zonder platform-context.
- Geen hosting-/platform-veld in de catalog.

## Contract / DB / API

- **Shared**: `hostingFingerprintSchema` — `{ platform: "vercel"|"netlify"|"cloudflare"|"fastly"|"cloudfront"|"github-pages"|"unknown", signals: string[], evidence_headers: Record<string,string> }`.
- **Catalog**: `{ id: "hosting-security", category: "http", name: "Hosting-fingerprint & platform-security", active: false }`, registreren in `registry.ts`.
- **Findings**: platform-gecontextualiseerde remediatie (config-bestand per platform); severity conform besluit 3 (grotendeels low/info; medium alleen bij een concreet lek zoals origin-IP naast CDN).
- **UI**: findings-lijst (HTTP). Optioneel een platform-badge op de site-detailpagina (hergebruik stack-detection-badge-slot).

## Stappen

1. Pure helper `fingerprintHosting(headers)` in `packages/shared` (of scan-core) met de header→platform-map en de signaal-extractie; unit-tests per platform-headerset.
2. Catalog-entry + registratie; `hosting-security`-check die de al-gefetchte response-headers doorgeeft aan de helper en de beoordeling toepast.
3. Remediatie-teksten per platform (fix-prompt plan 60): `vercel.json headers`, `netlify.toml [[headers]]`, Cloudflare Transform/Response-Header Rules.
4. Tests: header-fixtures per platform, onbekend-platform-degradatie, origin-lek-heuristiek.

## Open vragen

- Overlap met `security-headers` (28): dubbele findings vermijden. → *Voorstel*: `hosting-security` beoordeelt géén header-aanwezigheid opnieuw; het verrijkt alleen de remediatie-context en voegt platform-specifieke signalen toe die 28 niet kent (cache-hygiëne, origin-lek, preview-URL).
- Willen we de preview-/branch-URL-bevinding? Dat vereist herkennen dat de target een preview-deploy is (URL-patroon `*-git-*.vercel.app`, `*--*.netlify.app`). → *Voorstel*: ja, als info-finding op URL-patroon; geen extra request.

## Acceptatiecriteria

- [ ] Platform correct herkend uit headers voor Vercel/Netlify/Cloudflare met evidence-headers.
- [ ] Geen dubbele header-findings met check 28; remediatie is platform-specifiek.
- [ ] Onbekend platform → info-finding, geen score-straf; geen extra HTTP-request bovenop de bestaande fetch.
- [ ] `fingerprintHosting` is puur en unit-getest per platform-fixture.
