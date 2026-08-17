# Plan: Security headers — CSP, HSTS, XFO, Referrer-Policy, Permissions-Policy, COOP/COEP

**Doel**: Feature 28 — de HTTP-worker-check voor security headers. Vervangt de
huidige basis-check (`security-headers`, één samenvattende finding) door
per-header catalog-checks met eigen finding, ernst en remediatie, inclusief
inhoudelijke validatie (niet alleen "aanwezig ja/nee"). Checks: CSP, HSTS,
X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy,
COOP en COEP. Legt het per-header fan-out-patroon vast als blauwdruk voor
features 29–34.

**Status**: ✅ klaar (2026-08-17)

## Besluiten (bevestigd 2026-08-17)

1. **Per-header catalog-checks** (patroon `active-tests` uit plan 52/27): acht
   nieuwe catalog-entries in de http-categorie, elk met eigen finding + ernst +
   remediatie. De bestaande `security-headers`-entry wordt **verwijderd** uit
   de catalog (geen legacy-entry bewaren). De werking blijft in één
   implementatie-bestand (`apps/worker/src/checks/http/security-headers.ts`)
   dat **één HTTP-request** doet en alle headers uit dezelfde response
   evalueert (politeness: geen per-header requests). `outputCheckIds` in de
   registry = de acht nieuwe ids; de impl-id mag `security-headers` blijven
   (wordt niet als finding-id gebruikt; de scan-worker schrijft per result de
   `finding.check_id`).
2. **Aanwezigheid + inhoudelijke validatie**: per header wordt naast
   aanwezigheid ook de configuratie beoordeeld — CSP (unsafe-inline/unsafe-eval,
   wildcard, ontbrekende default-src, frame-ancestors), HSTS (max-age,
   includeSubDomains, preload), XFO (DENY/SAMEORIGIN, deprecated ALLOW-FROM),
   Referrer-Policy (unsafe-url), Permissions-Policy (wildcard op gevoelige
   features), COOP (unsafe-none), COEP (require-corp/credentialless),
   XCTO (nosniff). De CSP-parse is een lichte eigen directive-splitser (geen
   nieuwe dependency).
3. **Ernst-baseline** (voorstel, tabel in Contract): ontbrekend
   CSP/HSTS → high; ontbrekend XCTO/XFO/Referrer-Policy/Permissions-Policy/COOP
   → medium; ontbrekend COEP → low. Zwakke configuratie → medium/low (per
   regel in de tabel). Pass → info (scoring in `scoring.ts` telt info als
   pass, dus deze check vloeit via de bestaande pass-ratio in de scores).
   `warn`/`fail`-findings krijgen de header-waarde als `evidence` (string).
4. **XFO vs CSP frame-ancestors**: is `frame-ancestors` aanwezig in de CSP,
   dan is een ontbrekend XFO geen issue → `info` i.p.v. `medium`. Andersom
   geldt niet (frame-ancestors is de moderne vervanger).
5. **Inline probe (`apps/web/lib/scan-runner.ts`) blijft onaangeraakt** in deze
   feature: die gebruikt een eigen `INLINE_RUN_CHECKS`-lijst en wordt in
   plan 27 (altijd queue-modus) verwijderd. De catalog-entry
   `security-headers` verdwijnen heeft alleen gevolg voor de
   `checkById`-categorie-resolutie (fallback `http`) — geen gedragsverschil.
6. **Scoping**: dit plan dekt alleen feature 28. Features 29–34 (cookies, CORS,
   TLS, redirects/mixed, secrets-in-HTML, subresources) krijgen eigen plannen;
   de catalog-entries daarvan bestaan al (`check-catalog.ts`) maar worden pas
   door hun plan geïmplementeerd. Het progress-skelet telt alleen
   geïmplementeerde checks via de registry (`skeletonTotals`, plan 27).

## Uitgangssituatie (code vandaag)

- **Catalog** (`packages/shared/src/check-catalog.ts:25`): één entry
  `security-headers` (http, "Security headers"); de entries voor 29–34
  (cookies, cors, tls-cert, redirects-mixed, secrets-in-html, subresources)
  bestaan al als placeholder.
- **Worker-impl** (`apps/worker/src/checks/http/security-headers.ts`): checkt
  vijf headers (HSTS, CSP, XCTO, XFO, Referrer-Policy) op aanwezigheid en
  retourneert **één** samenvattende finding (`warn`/`fail` met ontbrekende
  namen). Geen content-validatie. Geregistreerd in
  `apps/worker/src/checks/registry.ts:45` (`toImplemented(securityHeadersCheck)`).
- **Titels/remediatie** (`packages/shared/src/findings.ts`): `ISSUE_TITLES` en
  `REMEDIATION` bevatten een `security-headers`-sleutel.
- **Tests die `security-headers` refrencen**: `check-catalog.test.ts:22`,
  `findings.test.ts:91,116`, `scan-progress-math.test.ts:52,88`,
  `scans-core.test.ts:425` en `scan-progress.test.ts:76` (web-inline).
- **Infra**: de scan-worker (plan 27) schrijft per result een `checks`-rij met
  `check_id = finding.check_id` en `advanceCategoryProgress`; de catalog is de
  bron voor categorie-resolutie (`checkById`) en het progress-skelet.
  Migraties lopen tot `016` (plan 27). **Geen DB-migratie nodig** voor deze
  feature (check = catalog-entry + worker-impl).

## Contract / DB / API

### Catalog (`packages/shared/src/check-catalog.ts`)

Acht nieuwe entries, `category: "http"`, `active: false`:

| id | name |
|---|---|
| `security-header-csp` | Content-Security-Policy (CSP) |
| `security-header-hsts` | HSTS (Strict-Transport-Security) |
| `security-header-xcto` | X-Content-Type-Options |
| `security-header-xfo` | X-Frame-Options |
| `security-header-referrer-policy` | Referrer-Policy |
| `security-header-permissions-policy` | Permissions-Policy |
| `security-header-coop` | Cross-Origin-Opener-Policy (COOP) |
| `security-header-coep` | Cross-Origin-Embedder-Policy (COEP) |

`security-headers` wordt verwijderd. Unieke-id-test blijft groen.

### Findings (`packages/shared/src/findings.ts`)

`ISSUE_TITLES` + `REMEDIATION` per nieuwe check-id (de oude
`security-headers`-sleutels verdwijnen). `evidence` (string) = header-waarde
bij `warn`/`fail`. Findings-payload v1 en `findingId`-logica ongewijzigd.

### Ernsten-baseline

| check | ontbreekt | zwakke configuratie |
|---|---|---|
| `security-header-csp` | high | medium: `unsafe-inline`/`unsafe-eval` in script/style-src, `*`-wildcard in default/script-src; low: geen `default-src` |
| `security-header-hsts` | high | medium: `max-age` < 31536000; low: geen `includeSubDomains` |
| `security-header-xcto` | medium | medium: aanwezig maar niet `nosniff` |
| `security-header-xfo` | medium (info als CSP `frame-ancestors` aanwezig) | medium: `ALLOW-FROM` (deprecated) |
| `security-header-referrer-policy` | medium | medium: `unsafe-url` |
| `security-header-permissions-policy` | medium | low: `*`/`all` op gevoelige features (camera, microfoon, geolocatie) |
| `security-header-coop` | medium | medium: `unsafe-none` |
| `security-header-coep` | low | low: niet `require-corp`/`credentialless` |

### DB / API

Geen wijzigingen. Geen migratie. Het progress-skelet van de http-categorie telt
via de registry acht checks i.p.v. één.

## Stappen

1. **Catalog (shared)**: acht entries toevoegen, `security-headers` verwijderen;
   `check-catalog.test.ts` (inlineIds-lijst) bijwerken.
2. **Findings (shared)**: `ISSUE_TITLES`/`REMEDIATION` per nieuw id invullen
   (concrete remediatie per header, zie Contract); oude sleutels verwijderen;
   `findings.test.ts`-fixtures op nieuwe ids zetten.
3. **Worker-impl herschrijven** (`security-headers.ts`): één `fetchPage`-call;
   per header een `InlineCheckLike` (id = catalog-id, name = catalog-name,
   status pass/warn/fail, detail met gevonden configuratie, evidence =
   header-waarde bij warn/fail). Content-validatie-hulpfuncties per header
   (CSP-directive-splitser, HSTS-directive-parse, etc.) als pure functies
   (testbaar, geen outbound I/O).
4. **Registry** (`registry.ts`): `outputCheckIds` = de acht ids; één fetch
   garandeert dat het rate-limit-mechanisme maar één keer per scan wordt
   aangeroepen voor deze check.
5. **Worker-tests** (nieuw): per header unit-tests met gemockte `Response`
   (aanwezig-pass, ontbreekt, zwakke config); CSP-parse-tests
   (unsafe-inline, wildcard, default-src, frame-ancestors); HSTS-parse-tests.
6. **Progress/skeleton**: `scan-progress-math.test.ts`-id bijwerken naar een
   nieuw id; skeletonTotals-test uitbreiden zodat de acht-header fan-out correct
   telt.
7. **Docs**: FEATURES.md (rij 28–34 opsplitsen: 28 → `28-security-headers` 📝,
   29–34 → eigen rij 💡), ROADMAP (Fase 3-taken + plan-overzicht). AGENTS.md
   hoeft niet te wijzigen (geen architectuur-verandering).

## Open vragen

1. ~~Eén samenvattende finding of per header?~~ → opgelost: per-header
   catalog-checks (Besluit 1).
2. ~~Alleen aanwezigheid of ook inhoud?~~ → opgelost: aanwezigheid + inhoud
   (Besluit 2).
3. ~~Welke headers?~~ → opgelost: de zes uit de opdracht (CSP, HSTS, XFO,
   Referrer-Policy, Permissions-Policy, COOP/COEP) + bestaande
   X-Content-Type-Options (Besluit 1; XCTO was al geïmplementeerd en is
   best practice).
4. ~~XFO verplicht naast CSP frame-ancestors?~~ → opgelost: frame-ancestors
   vervangt XFO (Besluit 4).
5. ~~CSP-parser: library of eigen?~~ → opgelost: lichte eigen directive-splitser
   (Besluit 2). Exacte zwaktes die we flaggen (bv. `'strict-dynamic'` vs
   `unsafe-inline`) nog bevestigen bij implementatie.
6. ~~Severity-baseline definitief?~~ → de tabel in Contract is het voorstel;
   bij implementatie samen met plan 08 (scoring) verifiëren dat de impact op
   de overall-score acceptabel is (8 info-findings bij een perfecte setup).
7. ~~Inline probe meenemen?~~ → opgelost: niet aanraken; plan 27 verwijdert
   de probe (Besluit 5).

## Acceptatiecriteria

- [ ] Catalog bevat acht `security-header-*`-checks (http) en geen
      `security-headers` meer; unieke-id-test groen.
- [ ] De http-worker produceert per header een eigen finding met eigen ernst +
      remediatie (pass → info); geen samenvattende "ontbrekende headers"-finding
      meer.
- [ ] Content-validatie werkt per header: CSP (unsafe-inline/eval, wildcard,
      default-src, frame-ancestors), HSTS (max-age, includeSubDomains), XCTO
      (nosniff), XFO (DENY/SAMEORIGIN, ALLOW-FROM, frame-ancestors-alternatief),
      Referrer-Policy (unsafe-url), Permissions-Policy (wildcard/unsafe), COOP
      (unsafe-none), COEP (require-corp/credentialless).
- [ ] Eén HTTP-request per scan voor alle acht headers (gedeelde response),
      via `fetchPage` + rate-limit.
- [ ] `evidence` bevat de header-waarde bij `warn`/`fail`.
- [ ] Progress: http-categorie telt acht checks; skeleton/advance-tests groen.
- [ ] Typecheck + tests groen (`pnpm typecheck`, `pnpm test`).
- [ ] FEATURES.md (28 → `28-security-headers`, 📝; 29–34 eigen rij) en
      ROADMAP (Fase 3 + plan-overzicht) bijgewerkt.