# Plan: Scan-progress live (SSE) — % per categorie met spinner-lijst

**Doel**: Tijdens een scan live de voortgang tonen — overall-% én per check-categorie (HTTP, SEO, AEO, GitHub) met een spinner-lijst van checks — via een SSE-route op de nieuwe scan-resultaatpagina, met poll-fallback. Het progress-/event-contract wordt nu in `packages/shared` vastgelegd, zodat de worker-pipeline (Feature 27+) er later 1-op-1 op aansluit.

**Status**: Klaar (2026-08-15).

## Besluiten (bevestigd 2026-08-15)

1. **DB-gedreven SSE**: `GET /api/scans/[id]/stream` pollt elke 2s de scans-rij uit Postgres en streamt events; geen Redis-pub/sub nodig (zelfde grondhouding als de scheduler uit plan 05)
2. **Progress-model**: `scans.progress` (int, overall-%) blijft bestaan; nieuwe kolom `scans.progress_details jsonb` draagt de per-categorie-structuur
3. **UI**: nieuwe scan-resultaatpagina `(dashboard)/scans/[id]`; zodra de scan terminal is sluit de stream en schakelt de pagina over naar de resultaatweergave (features 7/8 vullen die later aan)
4. **Categorieën**: `http | seo | aeo | github` — enum, progress-schema, eventtypes én de eerste check-catalog worden nu in `packages/shared` vastgelegd
5. **Poll-fallback**: als de SSE-verbinding faalt (proxy, timeout, buffering) valt de client terug op de bestaande `GET /api/scans/[id]` om de 3s
6. **Inline-modus (nu)**: `runInlineProbe` wordt gestapeld (per check een callback) en de probe loopt *buiten* de transactie, zodat voortgang zichtbaar wordt; zodra de BullMQ-pipeline er is gebruiken de workers dezelfde progress-helper

## Uitgangssituatie (code vandaag)

- `scans.progress` is een int 0–100; `GET /api/scans/[id]` (`apps/web/app/api/scans/[id]/route.ts`) bestaat met team-authz (membership-join) en retourneert status/progress/score/findings
- `runInlineProbe` (`apps/web/lib/scan-runner.ts`) draait **synchronisch binnen de transactie** van `POST /api/onboarding/sites` — tussentijdse progress is daardoor nu onzichtbaar; dat moet eerst anders (zie Besluit 6)
- Geen worker-pipeline, geen Redis-pub/sub, geen check-catalog in `packages/shared` (alleen `index.ts` + `plans.ts`)
- Geen sites-pagina (plan 04) en geen `POST /api/scans` (plan 05); de pagina is voorlopig bereikbaar via directe URL en later vanuit de onboarding-flow / sites-pagina

## DB (migratie `005_scan_progress.sql` in `packages/db`)

```sql
alter table scans add column progress_details jsonb not null default '{}'::jsonb;
```

`progress` (int) blijft de overall-%. Volgende vrije migratie is `005` — plan 04 claimt `002` (bezet door invites) en plan 05 claimt `004`; nummering bij merge afstemmen.

## Contract (`packages/shared`)

Nieuw bestand `src/scan-progress.ts`:

```ts
export const scanCategorySchema = z.enum(["http", "seo", "aeo", "github"]);
export type ScanCategory = z.infer<typeof scanCategorySchema>;

export const categoryProgressSchema = z.object({
  status: z.enum(["pending", "running", "done"]),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  percent: z.number().int().min(0).max(100),
  current_check: z.string().nullable(),
});
export type CategoryProgress = z.infer<typeof categoryProgressSchema>;

export const progressDetailsSchema = z.object({
  categories: z.record(scanCategorySchema, categoryProgressSchema),
  checks_done: z.number().int().min(0),
  checks_total: z.number().int().min(0),
  updated_at: z.string().datetime(),
});
export type ProgressDetails = z.infer<typeof progressDetailsSchema>;
```

Nieuw bestand `src/check-catalog.ts` — eerste lading uit de feature-lijst; per worker-feature uitbreiden (conventie AGENTS.md: "nieuwe check = catalog-entry + worker-implementatie"):

```ts
export const checkCatalogEntrySchema = z.object({
  id: z.string(),
  category: scanCategorySchema,
  name: z.string(),
});
export type CheckCatalogEntry = z.infer<typeof checkCatalogEntrySchema>;

export const categoryLabels: Record<ScanCategory, string> = {
  http: "HTTP & beveiliging",
  seo: "SEO & content",
  aeo: "AEO & browser",
  github: "GitHub & repo",
};
```

| id | categorie | naam |
|---|---|---|
| reachability | http | Reachability |
| https | http | HTTPS |
| security-headers | http | Security headers |
| cookies | http | Cookies audit |
| cors | http | CORS-configuratie |
| tls-cert | http | TLS/SSL-certificaat |
| redirects-mixed | http | Redirects & mixed content |
| secrets-in-html | http | Secrets in HTML |
| subresources | http | Subresource-integriteit |
| meta-tags | seo | Meta & OG-tags |
| robots-sitemap | seo | robots.txt & sitemap |
| security-txt | seo | security.txt, favicon, 404 |
| mini-crawl | seo | Interne links & broken links |
| structured-data | seo | Structured data (JSON-LD) |
| core-web-vitals | aeo | Core Web Vitals |
| accessibility | aeo | Accessibility (axe-core) |
| aeo-scan | aeo | AEO-content & LLM-parsability |
| semgrep | github | Semgrep (SAST) |
| gitleaks | github | Gitleaks (secrets) |
| osv-scanner | github | OSV-Scanner (deps) |
| repo-health | github | Repo-health |

De inline probe mapt op `reachability`, `https`, `security-headers`, `meta-tags` — zodat ook nu al échte (niet gesimuleerde) progress geschreven wordt.

## API route: `GET /api/scans/[id]/stream`

- Zelfde authz als `GET /api/scans/[id]` (membership-join, 401/404); `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `params` als Promise
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (nginx op de VPS), `Connection: keep-alive`
- Loop (elke 2s): scans-rij lezen (status, progress, progress_details, score, findings-counts) → bij wijziging een `progress`-event; bij terminale status het eind-event en close
- Heartbeat `: ping` elke 15s (proxy-keepalive); max ~5 min per verbinding (daarna close → client valt terug op poll); loop stopt bij `req.signal` (client weg)
- Eventtypes + payloads (zod, `scanProgressEventSchema` in shared):

```
event: progress
data: {"scan_id":"…","status":"running","progress":{"overall":40,"checks_done":3,"checks_total":6,"categories":{"http":{"status":"running","done":2,"total":4,"percent":50,"current_check":"Security headers"}}}}

event: completed
data: {"scan_id":"…","status":"completed","score":83,"summary":{"critical":0,"high":1,"medium":2,"low":1,"info":3}}

event: failed
data: {"scan_id":"…","status":"failed","error":"…"}
```

`completed` stuurt alleen counts (severity-verdeling uit `findings`); de volledige resultaten haalt de pagina daarna via `GET /api/scans/[id]` (features 7/8 breiden dit uit).

## Progress-writer

`apps/web/lib/scan-progress.ts` (server-only): `updateScanProgress(pool, scanId, patch)` — één atomische UPDATE van `progress` + `progress_details` (idempotent; callers rekenen de nieuwe stand uit). **Dezelfde helper gebruiken de workers straks** — de UI kent dus maar één bron van waarheid.

Inline-modus refactor (tijdelijk, tot de pipeline er is):

- `runInlineProbe(url, onCheck?)` → roept `onCheck(result)` aan per uitgevoerde check (categorie via catalog-lookup op check-id)
- `POST /api/onboarding/sites`: site + scans-rij + credit-spend blijven in de transactie, maar commit eerst met status `running`; de probe loopt daarna **buiten** de transactie en schrijft per check progress; finale update `completed` + score + findings
- De client leest tijdens `running` live de stream — hiermee is feature 6 vandaag al demonstreerbaar, zonder worker-pipeline

## UI

- **Hook `useScanProgress(scanId)`** (client): opent `EventSource(/api/scans/[id]/stream)`; bij error of close vóór terminale status → poll `GET /api/scans/[id]` elke 3s; bij `completed`/`failed` → nette eindtoestand. EventSource is GET-only — past precies op deze route
- **Pagina `(dashboard)/scans/[id]/page.tsx`**:
  - Header: site-URL + status + overall progressbar met %
  - Vier categorie-kaarten (HTTP & beveiliging / SEO & content / AEO & browser / GitHub & repo): eigen % + status-icoon (pending/running/done) + spinner-lijst van de catalog-checks in die categorie (✓/✗/⚠ zodra afgerond; spinner zolang actief; huidige check geaccentueerd via `current_check`)
  - Terminale staat: overall-score + per-categorie-scoreblok + plekhouder "Findings (feature 8)" + "Opnieuw scannen"-knop (koppelt zodra `POST /api/scans` uit plan 05 bestaat)
  - `failed`: foutmelding + retry-knop
- Navigatie: voorlopig directe URL + verwijzing vanuit de onboarding-flow; zodra de sites-pagina (plan 04) er is: rij → "Scan bekijken"

## Stappen

1. Migratie `005_scan_progress.sql` + shared: `scanCategorySchema`, `categoryProgressSchema`, `progressDetailsSchema`, event-schema's, `check-catalog.ts` (uniekheid van check-ids testen)
2. `lib/scan-progress.ts`: `updateScanProgress` (atomisch, idempotent) + unit-tests
3. `GET /api/scans/[id]/stream`: authz + SSE-loop + heartbeat + terminale events + abort/close
4. Refactor onboarding-route + `runInlineProbe(url, onCheck?)`: probe buiten transactie, per-check progress-writes
5. Hook `useScanProgress` + tests (mock EventSource, poll-fallback, reconnect)
6. Pagina `(dashboard)/scans/[id]`: progress-UI, categorie-kaarten, spinner-lijsten, resultaat-overgang
7. Testsuite: SSE-events via response-body-reader (TextDecoder), authz (geen teamlid → 404), heartbeat, close bij terminale status, fallback, monotonische progress in inline-modus

## Open vragen

- ~~SSE vs polling~~ → opgelost: DB-gedreven SSE + poll-fallback
- ~~Progress-model~~ → opgelost: `progress_details` JSONB per categorie, `progress` blijft overall
- ~~UI-locatie~~ → opgelost: nieuwe pagina `/scans/[id]`
- ~~Contract nu of later~~ → opgelost: nu, in `packages/shared`
- ~~`summary`-formaat in het `completed`-event~~ → opgelost: `severityCountsSchema` (critical/high/medium/low/info) in shared; afleiding uit findings (inline: fail→high, warn→medium, pass→info) tot feature 8 het versioned findings-schema levert
- ~~nginx-buffering / `maxDuration` bij VPS-deploy~~ → opgelost: headers (incl. `X-Accel-Buffering: no`) staan in de route; nginx-config volgt met de docker-compose deploy
- ~~Doorsturen vanuit de onboarding-wizard naar `/scans/[id]`, of progress embedded in de wizard?~~ → opgelost: de wizard stuurt na `POST /api/onboarding/sites` door naar `/scans/[id]` (één resultaatpagina); de sites-pagina linkt via "Bekijk" op de laatste scan

## Acceptatiecriteria

- [x] Stream geeft live progress: overall-% en per categorie oplopend, met de check-lijst (spinner → ✓/✗/⚠)
- [x] Bij voltooiing: `completed`-event, stream sluit, overgang naar score-resultaat; bij mislukking: `failed` + retry
- [x] Poll-fallback: bij EventSource-fout blijft de pagina updaten (3s-interval)
- [x] Alleen teamleden van het site-team kunnen de stream openen; anders 401/404
- [x] Heartbeat houdt de verbinding door proxies; client weg → loop stopt netjes
- [x] Contract (progress_details, eventtypes, catalog) ligt in `packages/shared`; de UI gebruikt het en de workers kunnen het straks onveranderd gebruiken
- [x] Inline-modus (zonder workers) toont échte oplopende progress in plaats van 0 → 100
