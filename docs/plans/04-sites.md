# Plan: Sites beheren (toevoegen + validatie + statuslijst)

**Doel**: Sites-pagina waar een team een website kan toevoegen (URL + optioneel GitHub-repo), met validatie, en een lijst met per site de actuele status (laatste scan + uptime).

**Status**: In uitvoering (🚧).

## Besluiten (bevestigd 2026-08-15)

1. **Canonieke URL**: protocol + www worden weggestript (`canonicalizeSiteUrl` in `packages/shared`), zodat `http(s)://www.voorbeeld.nl` en `voorbeeld.nl` één `sites.url` per team zijn; de canonieke vorm wordt opgeslagen (ook in de onboarding-route)
2. **Dedupe in code**: bestaande rijen (oud formaat met protocol) worden gecanonicaliseerd vergeleken; `unique(team_id, url)` blijft de DB-backstop (23505 → 409)
3. **Migratie-nummer**: `006_sites.sql` — `002` is bezet (invites) en plan 05/06 claimden `004`/`005`
4. **GitHub Pro-gating**: `POST`/`PATCH` met `github_repo` → `assertPlanFeature(..., "github")` → 403 + upsell-payload op Free
5. **Scan-knop**: koppelt nu aan `POST /api/onboarding/sites` (upsert + credit + scan); `POST /api/scans` is bewust van plan 05
6. **`last_scan_*`-cache**: `setSiteScanState` (lib/sites-core) werkt de kolommen idempotent bij — nu vanuit de onboarding-route (inline-modus), straks vanuit de dispatcher/aggregator (Fase 3)
7. **Reachability-probe**: niet bij toevoegen; de scan zelf bepaalt de bereikbaarheid

## Uitgangssituatie (code vandaag)

- `sites`-tabel bestaat (team_id, url, unique(team_id, url)); site-aanmaak gebeurt nu alleen via `POST /api/onboarding/sites` (inline modus)
- Er is nog geen `GET /api/sites`, geen sites-pagina, geen GitHub-repo-veld
- Feature 3 (billing) legt `features.github`-gating klaar; GitHub-scans zijn Pro-only
- `normalizeUrl` bestaat in `apps/web/lib/scan-runner.ts` (refactored naar `canonicalizeSiteUrl` uit `packages/shared`)

## DB (migratie `006_sites.sql` in `packages/db`)

Uitbreiden van `sites`:

- `github_repo text` (nullable) — genormaliseerd als `owner/repo`
- `label text` (nullable) — optionele eigen naam, default = hostname
- `last_scan_id uuid` (nullable, FK `scans(id)` on delete set null) — denormaliseerde status-cache
- `last_scan_status text` (nullable, check overeenkomstig `scan_status`)
- `last_scan_score int` (nullable)
- `last_scanned_at timestamptz` (nullable)
- `uptime_state text` default `'unknown'` check (`up`|`down`|`unknown`) — klaar voor Feature 5 (uptime); tot die tijd `unknown`

Twee keuzes voor "status van een site": (a) elke keer `GET /api/sites` een lateral join op `scans`, of (b) denormaliseren in `last_scan_*` kolommen. **Keuze: (b)** — de lijst is een hot read, en de BullMQ-dispatcher/aggregator update de kolommen na elke scan (idempotent). De kolommen zijn betrouwbaar genoeg zolang ze alleen door worker/webapp-batches worden geschreven.

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/sites` | GET | ingelogd | Lijst van team-sites + status (laatste scan, score, uptime), gesorteerd op `last_scanned_at` desc |
| `/api/sites` | POST | ingelogd | Site toevoegen: URL + optioneel GitHub-repo + label; validatie + dedupe; retourneert site (en start optioneel direct een scan via `POST /api/scans`) |
| `/api/sites/[id]` | PATCH | ingelogd | `github_repo`/`label` wijzigen, revalidatie |
| `/api/sites/[id]` | DELETE | ingelogd | Site + scans verwijderen (cascade) |

## Validatie (`packages/shared` + `lib/site-validation.ts`)

- `addSiteInputSchema`: `url` (refine op `canonicalizeSiteUrl`: hostname vereist + `.` in TLD), `github_repo` (optioneel: `owner/repo` formaat OF losse `github.com/owner/repo` URL die genormaliseerd wordt), `label` (optioneel, max 100 chars)
- **Canonieke dedupe**: `canonicalizeSiteUrl` (protocol + www-strippen) + `canonicalizeGithubRepo` (lowercase, alleen `[a-z0-9-_.]/[a-z0-9-_.]`, github.com-URL's daarbuiten afwijzen) in `packages/shared` — single source of truth, ook door de zod-schema's gebruikt
- **Reachable-check (optioneel)**: ~~bij POST een 5s HEAD/GET-probe~~ → vervallen, zie Besluiten 7
- `POST /api/sites` retourneert `409` bij duplicaat (bestaat al in dit team) i.p.v. stille upsert, tenzij `reuse: true` wordt meegegeven → dan bestaande site retourneren

## Status per site (lijst)

Combinatie van velden in de GET-respons:

```ts
siteWithStatusSchema = siteSchema.extend({
  github_repo: string.nullable(),
  label: string.nullable(),
  last_scan_id: uuid.nullable(),
  last_scan_status: scanStatusSchema.nullable(), // null = nog nooit gescand
  last_scan_score: number.int().min(0).max(100).nullable(),
  last_scanned_at: datetime.nullable(),
  uptime_state: enum("up","down","unknown"),
});
```

UI-statusberekening:
- geen scan → badge "Nog niet gescand"
- `queued`/`running` → badge "Scannen…" (groen pulserend)
- `completed` → score-badge (kleur per score-band) + datum
- `failed` → badge "Scan mislukt" (rood) + retry-knop
- uptime-kolom: `up`/`down`/`unknown` (tot Feature 5 altijd `unknown`/gedimd)

## UI

- Nieuwe route `(dashboard)/sites/page.tsx` + nav-link in de dashboard-layout
- **Add-formulier** (client component): URL-veld (met live-validatie van `addSiteInputSchema`), optioneel GitHub-repo-veld (helper-tekst `bijv. owner/repo`, alleen Pro-plan zichtbaar of met "Pro"-label), optioneel label; submit → `POST /api/sites` → `202`/`201` → refresh lijst; bij `409` melding "Staat al op je lijst" + knop "Toch scannen"
- **Lijst**: tabel — site (label + hostname), GitHub-repo badge (link naar repo), status-badge, score, laatste scan, uptime, acties (Scannen, Bewerken, Verwijderen met confirm)
- **Auto-refresh**: tijdens `queued`/`running` pollt de pagina om de 3s `GET /api/sites` (of hergebruik van het poll-mechanisme van de scan-resultaat-pagina)
- Empty state: "Nog geen sites — voeg je eerste website toe"
- Koppeling met Feature 3: bij limiet `402`-upsell tonen; GitHub-veld gated op `features.github`

## Stappen

1. Migratie `002_sites.sql` (+ rollback) en `packages/shared` uitbreiden: `siteSchema`, `addSiteInputSchema`, `siteWithStatusSchema`
2. `lib/site-validation.ts`: normalisatie (URL + GitHub), canonicalisatie, dedupe-logica; refactor `normalizeUrl` hierheen (of re-export)
3. `GET /api/sites` + `POST /api/sites` (met credit-afdwinging zodra Feature 3 klaar is; tot die tijd zonder)
4. `PATCH`/`DELETE /api/sites/[id]` (confirm in UI, cascade testen)
5. Sites-pagina: formulier + lijst + badges + poll-refresh + empty state; nav-update
6. Scan-koppeling: "Scannen"-knop → `POST /api/scans` (bestaat nog niet — tegen die tijd koppelen; nu nog via `POST /api/onboarding/sites`-logica of knop disabled met tooltip)
7. Worker/dispatcher: na scan-aggregatie `last_scan_*` kolommen updaten (vanaf het moment de BullMQ-pipeline er is)
8. Tests: validatie-cases (URL, GitHub-repo, dedupe, duplicaat 409), CRUD-rechten (alleen eigen team), lijst-status-weergave, verwijderen cascade

## Open vragen

- ~~Reachability-probe bij toevoegen: wel of niet (extra latency/rate-limit) — of als optionele client-side stap?~~ → opgelost: niet; de scan zelf bepaalt bereikbaarheid
- ~~GitHub-repo zonder URL, of alleen als aanvulling op een website-URL? (Geldt een "site" dan als repo-scan?)~~ → opgelost: alleen als aanvulling op een website-URL
- ~~Wordt `POST /api/scans` onderdeel van dit plan of een eigen plan (Feature 5+)?~~ → opgelost: eigen plan (05); de "Scannen"-knop koppelt nu aan `POST /api/onboarding/sites`
- ~~Max aantal sites per plan (Feature 3 limiet) — nu nog geen cap?~~ → opgelost: nu geen cap; credits (Feature 3) limiteren het aantal scans

## Acceptatiecriteria

- [ ] Site toevoegen via formulier (URL, optioneel GitHub-repo, label); validatiefouten inline getoond
- [ ] Duplicaten binnen een team → `409` met duidelijke melding; verschillende protocollen/www-varianten tellen als duplicaat
- [ ] Sites-lijst toont per site: naam/hostname, GitHub-repo, status-badge (nog niet gescand / scannen / klaar / mislukt), score, laatste scan-datum, uptime-veld
- [ ] Lijst ververst zichzelf tijdens een lopende scan; acties scannen/bewerken/verwijderen werken
- [ ] Alleen teamleden zien hun eigen sites; verwijderen verwijdert ook scans (cascade)
- [ ] GitHub-repo-veld is Pro-gated (Feature 3) en accepteert alleen geldige `owner/repo`
