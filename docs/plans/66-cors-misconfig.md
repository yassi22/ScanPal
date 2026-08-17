# Plan: CORS-misconfiguratie detectie (feature 30)

**Doel** — HTTP-worker check `cors` detecteert misconfigureerde CORS-headers op de
canonical page-URL: gereflecteerde arbitraire origins, `null`-origin acceptatie,
en de ongeldige `ACAO: *` + `ACAC: true`-combinatie. Eén check, één catalog-id,
draait in elke scan (passief, niet achter `activeTests`).

**Status** — 📝 plan klaar (2026-08-17)

## Besluiten (bevestigd 2026-08-17)

1. **Detectie-diepte = basis (1–2 requests).** Eén request met spoofed
   `Origin: https://evil.example` om reflectie te testen; optioneel een tweede
   met `Origin: null` om null-origin-acceptatie te detecteren. Geen preflight /
   `OPTIONS`-methode-tests, geen subdomein-traversal.
2. **Scope = host zelf.** Alleen de canonical page-URL uit `ctx.url`. Geen
   apex/www-varianten, geen andere paden. Houdt de check binnen het
   single-URL scanmodel.
3. **Altijd aan (passief).** Geen `active`-flag in de catalog-entry; draait in
   elk plan (ook Free). De requests zijn niet-invasive GETs met een spoofed
   `Origin`-header — geen state-mutatie op de target.
4. **Severiteit via het bestaande schema.** `pass|warn|fail` → `info|medium|high`
   (`SEVERITY_BY_STATUS` in `packages/shared/src/findings.ts`). Geen
   uitbreiding met `critical`; hoogste CORS-issue = `fail` (credentials +
   reflectie) = `high`.
5. **Eén catalog-output.** Check-id `cors` produceert één `InlineCheckLike`
   (geen split in sub-ids). De catalog-entry `cors` bestaat al in
   `check-catalog.ts:38`.
6. **Rate-limit verplicht.** Elk outbound request gaat door `ctx.rateLimit`
   (per-host Redis-limiter), conform `secrets-in-bundles` en `active-tests`.

## Uitgangssituatie (code vandaag)

- `packages/shared/src/check-catalog.ts:38` — entry `{ id: "cors", category: "http", name: "CORS-configuratie", active: false }`.
- `apps/worker/src/checks/registry.ts` — `http:`-array bevat
  `reachability, https, securityHeaders, metaTags, cookies,
  secretsInBundles, activeTests`. **Geen** `cors`-implementatie geregistreerd.
- `apps/worker/src/checks/types.ts` — `CheckImplementation`-contract
  (`id`, `category`, `run(ctx) → Promise<InlineCheckLike[]>`) en `fetchPage`
  (GET met timeout + UA, redirect follow). `fetchPage` ondersteunt extra
  `headers` — geschikt voor de spoofed `Origin`-header.
- `packages/shared/src/findings.ts` — `InlineCheckLike`
  (`id, name, status, detail, severity?, evidence?`), `ISSUE_TITLES` en
  `REMEDIATION`-mappen per check-id. **Ontbreken:** `cors` in zowel
  `ISSUE_TITLES` als `REMEDIATION` → na deze check toevoegen.
- `packages/shared/src/active-tests.ts` — `FindingEvidence = { request, response }`
  voor gestructureerd bewijs; `InlineCheckLike.evidence` accepteert ook een
  plain string. We gebruiken een string (`ACAO=…; ACAC=…`) zoals
  `security-headers` dat doet.

## Contract / DB / API

- **Geen schema-wijziging.** Findings worden als JSONB opgeslagen via
  `inlineChecksToFindings`; `cors` volgt hetzelfde pad als de andere
  security-header-checks.
- **Geen API-wijziging.** De check produceert findings in de bestaande
  `findings`-payload; de findings-API/filtering (feature 20) werkt zonder
  aanpassing.
- **Shared-contract-aanpassing** (`packages/shared/src/findings.ts`):
  - `ISSUE_TITLES["cors"]`: `{ warn: "CORS laat arbitraire origins toe", fail: "CORS reflecteert origins met credentials" }`
  - `REMEDIATION["cors"]`: "Beperk `Access-Control-Allow-Origin` tot een expliciete allowlist; reflecteer de `Origin`-header nooit onbewerkt; zet `Access-Control-Allow-Credentials: true` alleen op vertrouwde origins; sta `null` niet toe."
- **Worker** (`apps/worker/src/checks/http/cors.ts`): nieuwe
  `corsCheck: CheckImplementation`. `outputCheckIds = ["cors"]`.
- **Registry** (`apps/worker/src/checks/registry.ts`): voeg
  `toImplemented(corsCheck)` toe aan de `http:`-array.

## Detectie-logica

Twee probes, beide `GET ctx.url` via `fetchPage` met extra header:

1. `Origin: https://evil.example` (spoofed, niet gelijk aan de target-host).
2. `Origin: null` (gesandboxde iframe / `data:`-URL herkomst).

Evaluatie op de response-headers `access-control-allow-origin` (ACAO) en
`access-control-allow-credentials` (ACAC) van probe #1 (null-acceptatie uit
probe #2):

| Situatie | status | severity |
|---|---|---|
| ACAO == `<spoofed origin>` **en** ACAC == `true` | `fail` | `high` |
| ACAO == `<spoofed origin>` (zonder credentials) | `warn` | `medium` |
| ACAO reflecteert `null` (probe #2 → `null`) | `warn` | `medium` |
| ACAO == `*` **en** ACAC == `true` (ongeldige combinatie) | `warn` | `medium` |
| ACAO == `*` (zonder credentials) | `info` | — |
| Geen ACO-headers / vaste allowlist zonder reflectie | `pass` | — |

`detail` beschrijft de gevonden header-waarden; `evidence` = de ruwe
`ACAO`/`ACAC`-waarden (string). Bij netwerkfout: `status: "info"` met
detail "CORS niet controleerbaar: <fout>".

## Stappen

1. **Shared-contract** — voeg `cors` toe aan `ISSUE_TITLES` en `REMEDIATION` in
   `packages/shared/src/findings.ts`.
2. **Check-implementatie** — maak `apps/worker/src/checks/http/cors.ts`:
   - `export const corsCheck: CheckImplementation` met `id: "cors"`,
     `category: "http"`.
   - `run(ctx)`: haal naam uit `checkById("cors")`; voer de twee probes uit
     via `fetchPage(ctx.url, { headers: { Origin: ... } })`, telkens voorafgegaan
     door `await ctx.rateLimit.acquire()` (miror `secrets-in-bundles`).
   - Pure helper `evaluateCors({ acao, acac, nullAcao })` retourneert één
     `InlineCheckLike` — unit-testbaar zonder netwerk.
3. **Registry** — registreer `corsCheck` in de `http:`-array van
   `buildRegistry` in `registry.ts`.
4. **Tests** — `apps/worker/src/checks/http/__tests__/cors.test.ts`:
   - `evaluateCors`-cases voor elke rij in de detectie-tabel.
   - Mock `fetchPage` (of de global `fetch`) voor de `run`-integratie.
5. **Docs** — update `docs/FEATURES.md` rij 30: `Plan` = `66-cors-misconfig`,
   `Status` = 📝 (→ ✅ na acceptatie). Update `docs/ROADMAP.md` plan-overzicht.

## Open vragen

1. ~~Subdomeinen testen?~~ → besluit 2: alleen host zelf.
2. ~~`OPTIONS` preflight-test (ACRM/ACMH)?~~ → nee, buiten scope (basis). Kan
   in een latere uitbreiding (feature 30-v2) samen met method-enummeratie.
3. ~~`Origin: null` als tweede probe?~~ → ja, besloten (basis 1–2 requests).
4. ~~Moet de check ook draaien op non-HTML responses (bijv. een API-URL als
   canonical)?~~ → ja, CORS geldt voor alle responses; geen content-type-filter.
5. ~~`OPTIONS` preflight-test (ACRM/ACMH) in een v2 apart plannen?~~ → nee,
   binnen dit plan laten vallen. Baseline blijft origin-reflectie + null + `*`+credentials; preflight/method-enummeratie komt niet.

## Acceptatiecriteria

- `corsCheck` is geregistreerd en produceert één `InlineCheckLike` met
  `id: "cors"` per scan.
- `pnpm test` groen, inclusief nieuwe `cors.test.ts` die elke rij van de
  detectie-tabel dekt.
- `pnpm typecheck` en `pnpm lint` slagen.
- Een scan tegen een doel met `ACAO: *` + `ACAC: true` levert een
  `warn`/medium finding op met remediation-tekst; een doel met
  origin-reflectie + credentials levert `fail`/high.
- `docs/FEATURES.md` rij 30 verwijst naar `66-cors-misconfig` met status ✅.
