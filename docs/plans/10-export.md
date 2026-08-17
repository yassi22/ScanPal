# Plan: Export — PDF (react-pdf) en Markdown rapport

**Doel**: Van een afgeronde scan een downloadbaar rapport genereren in twee
formats — PDF via react-pdf en Markdown — met site-info, overall +
per-categorie scores en de findings gegroepeerd op ernst (inclusief remediatie
en evidence). Elke download wordt opgeslagen in de rapporten-historie. Features
9 (export, UI) en 21 (reports-API).

**Status**: ✅ klaar (geïmplementeerd en getest, 2026-08-17).

## Besluiten (bevestigd 2026-08-17)

1. **Server-side generatie** (geen client-rendering): beide formats worden in
   de webapp opgevraagd gegenereerd — één URL voor beide formats, geen
   client-side PDF-library
2. **Eén gedeelde rapport-data-builder**: `buildReportData(pool, scanId,
   teamId)` produceert één getypt object; zowel de Markdown- als de
   PDF-renderer consumeren datzelfde object (geen twee bronnen van waarheid)
3. **API-vorm**: `GET /api/reports/[scanId]?format=md|pdf` (route-tabel in
   `apps/web/AGENTS.md` reserveert `api/reports*` al voor feature 21); authz
   identiek aan `GET /api/scans/[id]`: sessie **of** API-key (Bearer
   `sp_live_…`, plan 14/25) via `lib/api-auth.ts` → `requireTeam` → 401/404
4. **Opslaan + historie (gewijzigd t.o.v. eerste plan-versie)**: bij elke
   download wordt het gegenereerde bestand **volledig opgeslagen** in een
   nieuwe `reports`-tabel (migratie 015). MD als `bytea` (content), PDF als
   `bytea`. Bewaren **onbeperkt**; geen opschoning in MVP
5. **Elke download = nieuwe historie-rij**: een tweede download van dezelfde
   scan+format slaat een nieuwe rij op (eigen `created_at`); geen dedup,
   geen "hergebruik van laatste"
6. **Alleen completed-scans**: non-completed → `409 Conflict` met status-message
7. **PDF**: `@react-pdf/renderer` 4.6.x (server-side `renderToBuffer`, A4
   portrait; peer-deps bevestigen React 19), download via
   `Content-Disposition: attachment`
8. **Markdown**: zelfde data-builder → platte MD met koppen, per-categorie-
   tabel en findings per ernst met remediatie; zelfde `Content-Disposition`
9. **Categorie-scores afleiden uit findings**: de kolom `category_scores`
   (plan 08) bestaat nog niet — dezelfde pass-ratio-logica als de huidige UI
   (`CategoryScore` in `scan-result.tsx`): per categorie `info`-findings /
   totaal × 100, `null` bij geen checks in die categorie. Zodra plan 08/27 de
   scores opslaat, leest het rapport die (output-vorm is dezelfde)
10. **Evidence in het rapport**: per finding worden description + remediatie +
    evidence getoond (waar aanwezig; evidence is string, `{request,response}`
    bij actieve tests, of bundle-secret-matches — via `evidenceText` in
    `packages/shared`)
11. **MVP: één rapporttype, géén `scope`-parameter**: het oude
    `scope=findings|full` vervalt — check-niveau-details bestaan niet meer
    apart (v1-findings, plan 09; geen checks-tabel tot Fase 3). `scope=full`
    komt pas terug als de pipeline een checks-tabel schrijft
12. **Titel/filename-conventie**: `scanpal-{site-host}-{scan-datum}.pdf|.md`,
    datum `YYYY-MM-DD`
13. **Taal van het rapport: Engels** (deelbaar met internationale partijen);
    UI blijft Nederlands
14. **Limiet**: top-100 findings per ernst in het rapport (tegen bloat);
    onderaan een regel "… and N more"
15. **Export-UI**: export-dropdown (PDF / Markdown) op de resultatenpagina
    `(dashboard)/scans/[id]`, alleen zichtbaar bij terminale `completed`-status
16. **Historie-UI (nieuw)**: aparte pagina `(dashboard)/reports` met lijst van
    opgeslagen rapporten (filter op site), per rij download-knop. Authz:
    team-scoped (membership-join)

## Uitgangssituatie (code vandaag)

- `GET /api/scans/[id]` (`apps/web/app/api/scans/[id]/route.ts`) retourneert de
  scans-rij met team-authz (membership-join) en geeft `findings` + `summary`
  mee — de rapport-route hergebruikt dezelfde query/helper
- Findings zitten in **v1-formaat** (`{ v: 1, items: [...] }`, plan 09 ✅):
  per finding `severity`, `category`, `title`, `description`, `remediation`,
  `evidence`, `status`, `note`; `scans.score` (int) bestaat al
- **Geen** `scans.category_scores`-kolom (plan 08 📝, niet geïmplementeerd) —
  de UI rekent categorie-scores nu ad-hoc uit findings
  (`components/scan-result.tsx`, `CategoryScore`); het rapport doet dat eerst
  op dezelfde manier
- **Geen** `api/reports*`-route, geen `packages/shared/src/report.ts`, geen
  `scoring.ts`; `@react-pdf/renderer` is geen dependency in
  `apps/web/package.json` (4.6.x ondersteunt React 19)
- Resultatenpagina `(dashboard)/scans/[id]` (plan 06/09/13) bestaat met
  score-header + findings-panel (`FindingsPanel`); de export-knoppen landen
  daarop
- Migraties lopen tot `014`; dit plan voegt **migratie 015** toe
- `evidenceText` (evidence → tekst) bestaat al in `packages/shared/src/findings.ts`

## Contract (`packages/shared`, nieuw)

Nieuw bestand `packages/shared/src/scoring.ts` (stond al gepland in
`packages/shared/AGENTS.md`; één bron voor het scoring-contract dat plan 08
later uitbreidt):

```ts
export const categoryScoresSchema = z.object({
  http: z.number().int().min(0).max(100).nullable(),
  seo: z.number().int().min(0).max(100).nullable(),
  aeo: z.number().int().min(0).max(100).nullable(),
  github: z.number().int().min(0).max(100).nullable(),
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;

export function categoryScoresFromFindings(
  findings: Finding[],
): CategoryScores; // pass-ratio per categorie (info/totaal × 100), null = geen checks
```

Nieuw bestand `packages/shared/src/report.ts` (dependency-free, alleen zod):

```ts
export const reportFormatSchema = z.enum(["md", "pdf"]);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

export const reportDataSchema = z.object({
  scan: z.object({
    id: z.string().uuid(),
    trigger: scanTriggerSchema,
    created_at: z.string().datetime(),
    completed_at: z.string().datetime(),
  }),
  site: z.object({ url: z.string(), label: z.string().nullable() }),
  score: z.number().int().min(0).max(100),
  category_scores: categoryScoresSchema,
  summary: severityCountsSchema,
  findings: z.array(findingSchema), // gesorteerd op ernst (critical → info), max 100 per ernst
});
export type ReportData = z.infer<typeof reportDataSchema>;

export const reportMetaSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  scan_id: z.string().uuid(),
  format: reportFormatSchema,
  filename: z.string(),
  size_bytes: z.number().int().min(0),
  created_at: z.string().datetime(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

export const reportListResponseSchema = z.object({
  reports: z.array(reportMetaSchema),
});
export type ReportListResponse = z.infer<typeof reportListResponseSchema>;
```

`findingSchema`, `severityCountsSchema`, `scanTriggerSchema` en `evidenceText`
komen uit `findings.ts` / `scan-progress.ts` / `scans.ts` — dit plan
dupliceert die contracten niet, alleen de rapport-weergave. Beide renderers
valideren hun input met `reportDataSchema`; de route geeft altijd geldige data,
dus de renderers blijven puur.

## DB (migratie `015_reports.sql`)

```sql
create table reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  scan_id uuid not null references scans(id) on delete cascade,
  format text not null check (format in ('md', 'pdf')),
  filename text not null,
  content bytea not null,
  size_bytes int not null,
  created_at timestamptz not null default now()
);

create index reports_team_created_idx on reports (team_id, created_at desc);
create index reports_site_idx on reports (site_id);
```

Team-scoping: `team_id` wordt expliciet opgeslagen (niet afgeleid) zodat de
historie-lijst en downloads met één kolom filteren; schrijft gebeuren alleen na
de authz-check op `requireTeam` (client kan `team_id` nooit zelf sturen).

## API

### `GET /api/reports/[scanId]?format=md|pdf`

- Query-param `format` (zod: `reportFormatSchema`, default `md`); ongeldige
  waarde → `400`
- Authz identiek aan `GET /api/scans/[id]`: `requireTeam` (sessie óf API-key)
  + scans JOIN sites JOIN memberships op team_id; geen match → `404` (geen
  existence-leak)
- Scan-status ≠ `completed` → `409` met `{ error, status }`
- Flow: `buildReportData` → renderer per format → rij in `reports` (team_id,
  site_id, scan_id, format, filename, content, size_bytes) → response
- Responses:
  - Markdown: `Content-Type: text/markdown; charset=utf-8`,
    `Content-Disposition: attachment; filename="scanpal-{host}-{date}.md"`
  - PDF: `Content-Type: application/pdf`,
    `Content-Disposition: attachment; filename="scanpal-{host}-{date}.pdf"`
    (buffer uit `renderToBuffer`)
- Response-headers mogen ook `X-Report-Id` bevatten (id van de nieuwe rij),
  zodat de client de historie kan refreshen

### `GET /api/reports?site_id=`

- Authz via `requireTeam`; optionele `site_id`-filter (moet bij het team
  horen; anders 404)
- Retourneert `reportListResponseSchema` (`{ reports: ReportMeta[] }`),
  gesorteerd op `created_at desc`, gelimiteerd op 100

### `GET /api/reports/[id]/content`

- Authz: reports JOIN teams op team_id via `requireTeam`; geen match → 404
- Retourneert de opgeslagen bytes met `Content-Type` (text/markdown of
  application/pdf, op basis van `format`-kolom) + `Content-Disposition:
  attachment; filename="<opgeslagen filename>"` — geen regeneratie

## Stappen

1. `packages/shared/src/scoring.ts`: `categoryScoresSchema` +
   `categoryScoresFromFindings` (pass-ratio, null-categorieën) + re-export via
   `index.ts`; unit-tests (pass-ratio, lege categorie → null, geen checks)
2. `packages/shared/src/report.ts`: `reportFormatSchema` + `reportDataSchema`
   + `reportMetaSchema` + `reportListResponseSchema` + re-export via
   `index.ts`; tests (parse, format-enum)
3. `packages/db/migrations/015_reports.sql`: tabel + indexes (zie DB-sectie);
   registratie in `packages/db` migrate-runner indien nodig
4. `apps/web`: dependency `@react-pdf/renderer@^4.6` toevoegen
5. `lib/report/data.ts`: `buildReportData(pool, scanId, teamId)` — één query
   (scan + site via team-join), findings parsen via `findingsPayloadSchema`
   (plan 09), categorie-scores via `categoryScoresFromFindings`, findings
   sorteren op ernst + top-100 cap per ernst
6. `lib/report/markdown.ts`: renderer (Engels) — koppen, meta-tabel
   (site/url/scan-id/datum/trigger), overall score, per-categorie-tabel,
   findings per ernst (`## Critical`, …) met description + remediation +
   evidence (via `evidenceText`), "… and N more", footer met datum + ScanPal
7. `lib/report/pdf.tsx`: react-pdf `<Document>` (titelblok, overall score,
   categorie-tabel, findings per ernst met remediatie + evidence, A4) +
   `renderToBuffer`
8. `lib/report/store.ts`: `saveReport(pool, {teamId, siteId, scanId, format,
   filename, content})` → insert + `ReportMeta`; `listReports(pool, {teamId,
   siteId?})` → `ReportMeta[]`; `getReportContent(pool, {teamId, reportId})` →
   rij of null
9. Routes: `app/api/reports/[scanId]/route.ts` (download + opslaan),
   `app/api/reports/route.ts` (historie-lijst),
   `app/api/reports/[id]/content/route.ts` (opgeslagen download) — zod → authz
   → status-check (409) → data/opslag → response met headers
10. UI: export-dropdown op `(dashboard)/scans/[id]` (`scan-result.tsx`, alleen
    bij `completed`): PDF / Markdown → download via `<a href>` /
    `window.location`, daarna router.refresh()
11. UI: pagina `(dashboard)/reports/page.tsx` (+ client-component) — lijst met
    filter op site (dropdown), per rij format/icoon, datum, omvang en
    download-link naar `api/reports/[id]/content`; link vanuit de
    dashboard-nav
12. Testsuite (vitest in apps/web):
    - authz: geen teamlid → 404, ongeldige API-key → 401/404
    - ongeldige format → 400; non-completed → 409
    - MD-snapshot-test (Engels, scores, remediatie, evidence, top-100-cap)
    - PDF-buffer begint met `%PDF` en heeft `attachment`-header
    - `reportDataSchema` parset echte scan-data
    - historie: lijst is team-scoped, `site_id`-filter werkt, download van
      opgeslagen rij retourneert dezelfde bytes + filename
13. `apps/web/AGENTS.md` route-tabel: `api/reports*` concreet maken
14. FEATURES.md (9, 21 → status 🚧) en ROADMAP-plan-overzicht bijwerken

## Open vragen

- ~~Client- vs server-side PDF~~ → opgelost: server-side `renderToBuffer`
- ~~API-vorm~~ → opgelost: `GET /api/reports/[scanId]?format=`
- ~~Rapport opslaan~~ → opgelost: **ja, opslaan + historie** (migratie 015,
  volledige bestanden, onbeperkt bewaren)
- ~~Check-details wel/niet~~ → opgelost: MVP één rapporttype (geen `scope`);
  check-niveau-details pas met de checks-tabel van de pipeline (Fase 3)
- ~~Categorie-scores~~ → opgelost: afleiden uit findings (zelfde logica als
  UI); overschakelen naar `category_scores`-kolom zodra plan 08/27 die schrijft
- ~~Taal~~ → opgelost: Engels
- ~~Findings-limiet~~ → opgelost: top-100 per ernst + teller
- ~~Evidence in rapport~~ → opgelost: ja, via `evidenceText`
- ~~Historie-UI~~ → opgelost: aparte reports-pagina + download
- ~~API-toegang~~ → opgelost: sessie én API-key (`requireTeam`)
- ~~UI-locatie~~ → opgelost: export-dropdown op resultatenpagina, alleen
  `completed`
- ~~Retentie~~ → opgelost: onbeperkt bewaren, geen opschoning in MVP
- Nieuw: react-pdf werkt met eigen font-registratie — default Helvetica
  volstaat voor Latijnse tekens, geen webfonts nodig? (aanname: ja, MVP)
- Nieuw: opslaan van PDF als `bytea` — PDF-buffers voor zware scans (200+
  findings) kunnen ~1 MB zijn; geen probleem voor PostgreSQL (aanname: ja)

## Acceptatiecriteria

- [ ] `GET /api/reports/[scanId]?format=md` retourneert een geldig
      Markdown-rapport (Engels) met meta, overall score, per-categorie-scores
      en findings per ernst (incl. remediatie én evidence) en slaat de rij op
- [ ] `?format=pdf` retourneert een geldige PDF (start met `%PDF`,
      renderbaar, A4) en slaat de rij op
- [ ] Categorie-scores zijn pass-ratio's uit findings; categorieën zonder
      checks tonen "niet gescand" (geen 0)
- [ ] Top-100 per ernst met "… and N more"; geen onbeperkte bloat
- [ ] Beide zijn downloads met correcte `Content-Disposition`-filename
      (`scanpal-{host}-{date}.{ext}`)
- [ ] Authz identiek aan scans: teamlid via sessie óf API-key (404 voor
      non-members); non-completed → 409; ongeldige format → 400
- [ ] Elke download legt een nieuwe rij in `reports` vast (team-scoped)
- [ ] `GET /api/reports` toont team-scoped historie (filter op site werkt);
      `GET /api/reports/[id]/content` retourneert de opgeslagen bytes +
      filename zonder regeneratie
- [ ] UI: export-dropdown op de resultatenpagina werkt (alleen bij
      `completed`); de reports-pagina toont de historie met download
- [ ] `reportDataSchema` + `reportFormatSchema` + `reportMetaSchema` liggen in
      `packages/shared`; `categoryScoresSchema` + `categoryScoresFromFindings`
      in `scoring.ts`; renderers delen één `buildReportData` (geen duplicatie)
- [ ] Migratie 015 is een schone upsert via `packages/db` migrate-runner
- [ ] FEATURES.md (9, 21 → 10-export, 🚧) en ROADMAP-plan-overzicht
      bijgewerkt