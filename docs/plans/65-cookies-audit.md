# Plan: Cookies audit — HttpOnly, Secure, SameSite (+ prefixes, expiry)

**Doel**: Feature 29 — de HTTP-worker-check voor cookie-security. Parsed de
`Set-Cookie`-headers van de hoofd-document-response en beoordeelt per cookie
op HttpOnly, Secure en SameSite, aangevuld met prefix- en expiry-validatie.
Volgt het per-attribuut fan-out-patroon van plan 28: vijf catalog-checks, elk
met eigen finding, ernst en remediatie. Passief — er worden geen cookies
geplaatst en JS-gezette cookies (document.cookie) vallen buiten scope (die
zien we pas met de browser-worker, features 41–43).

**Status**: ✅ Klaar (2026-08-17) — feature 29 opgeleverd in Fase 3.

## Besluiten (bevestigd 2026-08-17)

1. **Per-attribuut catalog-checks** (patroon plan 28): vijf nieuwe entries in
   de http-categorie: `cookie-httponly`, `cookie-secure`, `cookie-samesite`,
   `cookie-prefixes`, `cookie-expiry`. De bestaande `cookies`-entry wordt
   **verwijderd** uit de catalog. De werking zit in één implementatie-bestand
   (`apps/worker/src/checks/http/cookies.ts`) dat **één HTTP-request** doet en
   alle cookies uit dezelfde response evalueert (politeness: geen
   per-cookie/attribuut-requests). `outputCheckIds` in de registry = de vijf
   nieuwe ids; de impl-id mag `cookies` blijven (wordt niet als finding-id
   gebruikt; de scan-worker schrijft per result de `finding.check_id`).
2. **Scope = passief, hoofdresponse**: alleen de `Set-Cookie`-headers van de
   document-response die `fetchPage` teruggeeft (inclusief wat de
   redirect-follow blootlegt). JS-gezette cookies zien we niet; dat is een
   browser-worker-taak (41–43) en wordt bewust niet in deze feature
   meegenomen.
3. **Sessie-cookie-detectie met severity-bump**: een pure functie
   `isSessionCookie(name)` herkent sessie-achtige namen (naam of lowercase
   patroon bevat `session`/`sess`/`sid`/`auth`/`token`/`credential`, plus een
   expliciete set: `jsessionid`, `phpsessid`, `connect.sid`,
   `asp.net_sessionid`, `laravel_session`, `wordpress_logged_in`,
   `wordpress_sec`, `cfid`, `cftoken`, `rails.session`, `_session_id`).
   Ontbrekend Secure/HttpOnly op zo'n cookie → **high** i.p.v. medium.
4. **Extra attributen**: naast de drie uit de titel valideert de check ook
   `__Host-`/`__Secure-`-prefix-vereisten (`cookie-prefixes`) en
   `Expires`/`Max-Age` op sessie-cookies (`cookie-expiry`). Path/Domain worden
   **niet** beoordeeld (scope-besluit 1, te veel ruis).
5. **Eigen fetch per check**: geen shared response-cache in `CheckContext`;
   de cookies-check doet een eigen `fetchPage`-call via het bestaande
   rate-limit-mechanisme (huidig patroon, geen refactor van de http-worker).
6. **Parse**: eigen lichte parser (geen nieuwe dependency). Set-Cookie-splits
   op `;` (nooit op komma — het `Expires`-attribuut bevat komma's), respecteer
   quotes in de waarde, attributen case-insensitief. Lees de headers via
   `response.headers.getSetCookie()` (undici/Node ≥ 18.14); bij de
   implementatie de Node-versie van de worker-container verifiëren.
7. **Scoping**: dit plan dekt alleen feature 29. Features 30–34 (CORS, TLS,
   redirects/mixed, secrets-in-HTML, subresources) krijgen eigen plannen; hun
   catalog-entries bestaan al maar worden pas door hun plan geïmplementeerd.
   Het progress-skelet telt alleen geïmplementeerde checks via de registry
   (`skeletonTotals`, plan 27).

## Uitgangssituatie (code vandaag)

- **Catalog** (`packages/shared/src/check-catalog.ts:26`): één entry `cookies`
  (http, "Cookies audit") zonder implementatie; de entries voor 30–34 (cors,
  tls-cert, redirects-mixed, secrets-in-html, subresources) bestaan als
  placeholder.
- **Worker** (`apps/worker/src/checks/http/`): patroon = één
  `CheckImplementation` + `outputCheckIds` in
  `apps/worker/src/checks/registry.ts` (plan 28, besluit 1). `fetchPage`
  (`apps/worker/src/checks/types.ts`) is de enige outbound-helper.
- **Findings** (`packages/shared/src/findings.ts`): `inlineChecksToFindings`
  mapt pass→info / warn→medium / fail→high, met severity-override via
  `InlineCheckLike.severity` (plan 52/53) en `ISSUE_TITLES`/`REMEDIATION`
  per check-id. `evidence` is string (of structured) — hier de
  cookie-header-rij.
- **Tests die `cookies` referencen**: `check-catalog.test.ts` (unieke-id + de
  inline-probe-ids-lijst) en `scan-progress-math.test.ts` (skeleton-totalen
  als het http-queue-patroon).
- **Infra**: de scan-worker (plan 27) schrijft per result een `checks`-rij met
  `check_id = finding.check_id` en `advanceCategoryProgress`; de catalog is de
  bron voor categorie-resolutie (`checkById`) en het progress-skelet. **Geen
  DB-migratie** nodig (check = catalog-entry + worker-impl).

## Contract / DB / API

### Catalog (`packages/shared/src/check-catalog.ts`)

Vijf entries, `category: "http"`, `active: false`:

| id | name |
|---|---|
| `cookie-httponly` | Cookie HttpOnly |
| `cookie-secure` | Cookie Secure |
| `cookie-samesite` | Cookie SameSite |
| `cookie-prefixes` | Cookie prefix (__Host-/__Secure-) |
| `cookie-expiry` | Cookie expiry (Expires/Max-Age) |

`cookies` wordt verwijderd. Unieke-id-test blijft groen.

### Findings (`packages/shared/src/findings.ts`)

`ISSUE_TITLES` + `REMEDIATION` per nieuw check-id (concrete remediatie per
attribuut, zie Contract); de oude `cookies`-sleutels verdwijnen. `evidence`
(string) = de `Set-Cookie`-header(s) van de aangedane cookies bij
`warn`/`fail`. Findings-payload v1 en `findingId`-logica ongewijzigd
(finding-id is per check-id + titel, dus per attribuut stabiel over scans →
carry-over uit plan 09 werkt gewoon).

### Ernsten-baseline

| check | conditie | ernst |
|---|---|---|
| `cookie-httponly` | ontbreekt op sessie-cookie | high |
| `cookie-httponly` | ontbreekt op andere cookie | medium |
| `cookie-secure` | ontbreekt op sessie-cookie | high |
| `cookie-secure` | ontbreekt op andere cookie | medium |
| `cookie-samesite` | ontbreekt | medium |
| `cookie-samesite` | `SameSite=None` zonder `Secure` | high (ongeldig — browser verwerpt de cookie) |
| `cookie-prefixes` | `__Secure-` zonder Secure, of `__Host-` zonder Secure + Path=/ + geen Domain | low |
| `cookie-expiry` | sessie-cookie met `Expires`/`Max-Age` (blijft bewaard na sluiten) | low |
| alle | geen cookies aanwezig / alles correct | pass → info |

Pass → info (scoring telt info als pass → vloeit via de bestaande pass-ratio
in de scores). `warn`/`fail`-findings met severity-override via
`InlineCheckLike.severity` (high/low zoals boven); de default-status-kaart
blijft voor medium.

### DB / API

Geen wijzigingen. Geen migratie. Het progress-skelet van de http-categorie
telt via de registry vijf checks i.p.v. één.

## Stappen

1. **Catalog (shared)**: vijf entries toevoegen, `cookies` verwijderen;
   `check-catalog.test.ts` (unieke-id + inlineIds-lijst) bijwerken.
2. **Findings (shared)**: `ISSUE_TITLES`/`REMEDIATION` per nieuw id invullen
   (remediatie per attribuut: HttpOnly → sessie-cookies uit JS-toegang halen;
   Secure → alleen over HTTPS versturen; SameSite → Lax/Strict + geen None
   zonder Secure; prefixes → __Host-/__Secure- correct toepassen; expiry →
   sessie-cookies niet persistent maken); oude `cookies`-sleutels verwijderen;
   `findings.test.ts`-fixtures op nieuwe ids zetten.
3. **Worker-impl nieuw** (`cookies.ts`): pure helpers `parseSetCookieHeader`
   (splits op `;`, quote-aware waarde, case-insensitieve attributen, meerdere
   Set-Cookie-headers) en `isSessionCookie`; daarna per attribuut een
   `InlineCheckLike` (id = catalog-id, name = catalog-name, status
   pass/warn/fail, detail met cookie-namen + gevonden configuratie, evidence =
   header(s) bij warn/fail, severity-override waar nodig). Eén `fetchPage`-call
   via het bestaande rate-limit-mechanisme.
4. **Registry** (`registry.ts`): `outputCheckIds` = de vijf ids; de
   implementatie produceert altijd alle vijf (ook bij nul cookies → pass/info),
   zodat het progress-skelet stabiel blijft.
5. **Worker-tests** (nieuw): parser-tests (quotes in waarde, komma's in
   `Expires`, meerdere cookies over meerdere headers, malformed/lege waarde),
   `isSessionCookie`-patronen, per-attribuut scenario's (alles-pass, gemengde
   fouten, SameSite=None zonder Secure, __Host-/__Secure-misbruik, sessie- vs
   niet-sessie-cookie) en de verwachte severity per geval.
6. **Progress/skeleton**: `scan-progress-math.test.ts`-skeleton-verwachtingen
   bijwerken (vijf i.p.v. één in de http-categorie) zodat de fan-out correct
   telt.
7. **Docs**: FEATURES.md (rij 29–34 opsplitsen: 29 → eigen rij
   `65-cookies-audit` 📝, 30–34 blijven als eigen rij 💡), ROADMAP
   (Fase 3-taken + plan-overzicht). AGENTS.md hoeft niet te wijzigen (geen
   architectuur-verandering).

## Open vragen

1. ~~Eén samenvattende finding of per attribuut?~~ → opgelost: per-attribuut
   catalog-checks (Besluit 1).
2. ~~Scope: alleen hoofdresponse of ook JS-cookies?~~ → opgelost: passief,
   hoofdresponse; JS-cookies zijn browser-worker (41–43) (Besluit 2).
3. ~~Sessie-cookies anders wegen?~~ → opgelost: ja, severity-bump via
   `isSessionCookie` (Besluit 3). Exacte patroon-set bij implementatie
   bevestigen (te agressief = te veel high-findings).
4. ~~Welke attributen naast de drie?~~ → opgelost: prefixes + expiry; geen
   Path/Domain (Besluit 4).
5. ~~Eén fetch delen over http-checks?~~ → opgelost: eigen fetch per check,
   geen CheckContext-refactor (Besluit 5).
6. ~~Cookie-parse met library?~~ → opgelost: eigen lichte parser (Besluit 6);
   `getSetCookie()`-beschikbaarheid in de worker-Node-version verifiëren.
7. ~~Wat bij nul cookies?~~ → opgelost: vijf pass/info-findings, skeleton
   blijft stabiel (Stap 4).

## Acceptatiecriteria

- [x] Catalog bevat vijf `cookie-*`-checks (http) en geen `cookies` meer;
      unieke-id-test groen.
- [x] De http-worker produceert per attribuut een eigen finding met eigen ernst
      + remediatie (pass → info); geen samenvattende "cookies"-finding meer.
- [x] Parser werkt met quotes in de waarde, komma's in `Expires`, meerdere
      `Set-Cookie`-headers en malformed input (geen crash).
- [x] Sessie-detectie (`isSessionCookie`) geeft de severity-bump (high i.p.v.
      medium) voor ontbrekend Secure/HttpOnly.
- [x] `SameSite=None` zonder `Secure` → high (ongeldige cookie).
- [x] `__Host-`/`__Secure-`-prefix-vereisten en persistentie op sessie-cookies
      worden beoordeeld (low).
- [x] Site zonder cookies → vijf pass/info-findings; progress-skelet telt vijf
      checks.
- [x] Eén HTTP-request per scan voor de cookies-check, via `fetchPage` +
      rate-limit.
- [x] `evidence` bevat de cookie-header(s) bij `warn`/`fail`.
- [x] Typecheck + tests groen (`pnpm typecheck`, `pnpm test`).
- [x] FEATURES.md (29 → eigen rij `65-cookies-audit` ✅; 30–34 blijven) en
      ROADMAP (Fase 3 + plan-overzicht) bijgewerkt.