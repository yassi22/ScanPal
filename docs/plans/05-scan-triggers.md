# Plan: Scan triggeren (direct / dagelijks / wekelijks)

**Doel**: Een scan starten op drie manieren — direct (knop), dagelijks en wekelijks (schema per site) — met credit-afdwinging (Feature 3) en koppeling aan de scan-pipeline.

**Status**: ✅ Klaar (2026-08-15).

## Besluiten (bevestigd 2026-08-15)

1. Scheduling (daily/weekly) is **Pro-only** (Feature 3 gating); Free-plan kan alleen direct scannen
2. **DB-gedreven scheduler** (eigen Node-proces, poll elke 60s) — geen BullMQ-repeatable jobs nodig; kan later op de BullMQ-pipeline overstappen
3. Vaste tijd: **09:00 UTC** voor alle geplande scans (geen per-site tijd of tijdzone)
4. Credit-limiet bij geplande run: **skip + mail**; schema blijft actief
5. Notificaties bij geplande scans: **alleen mail bij score-daling of mislukte scan**
6. `GET /api/scans` (historie) **meteen meegeleverd** (open vraag opgelost) — de sites-pagina toont nog geen historie, maar de route is er en getest
7. `sites.last_scan_at` **niet toegevoegd**: `last_scanned_at` (plan 04) vervult die rol al — hij wordt bij elke scan-start door `setSiteScanState` gezet
8. `computeNextScanAt`/`next09Utc` wonen in **`packages/shared`** (`src/schedule.ts`); `apps/web/lib/schedule.ts` re-exporteert, de scheduler importeert rechtstreeks
9. De scheduler heeft eigen minimale kopieën van `spendCredit` en de scan-SQL-helpers (`apps/scheduler/src/credits.ts` + inline in `core.ts`): de webapp-libs importeren `server-only` en zijn niet bruikbaar vanuit het losse Node-proces. Tijdelijke duplicatie — verdwijnt zodra de BullMQ-pipeline (Fase 3) een gedeelde worker-lib heeft
10. In queue-modus (`SCAN_MODE=queue`) blijft een directe scan `queued` (202) en draait de scheduler de probe inline — enqueue volgt met de pipeline (Fase 3)

## Uitgangssituatie (code vandaag)

- Scans ontstaan nu alleen via `POST /api/onboarding/sites` (inline modus, `runInlineProbe` in `apps/web/lib/scan-runner.ts`); er is **geen** `POST /api/scans` (plan 04 hield dat bewust open)
- BullMQ/worker-pipeline bestaat nog niet (alleen `apps/web`); `env.scanMode === "inline"` is de dev-stand-in
- `sites`-tabel heeft geen schema-velden; `scans` heeft geen trigger-metadata (zie migratie `001`)
- Feature 3 (billing) legt de credit-check klaar; Feature 4 (sites) bouwt de sites-pagina waar de knoppen komen

## Keuze: DB-gedreven scheduler (nu) i.p.v. BullMQ repeatable jobs

BullMQ repeatable jobs zijn de eind-architectuur (AGENTS.md), maar vereisen Redis + een draaiende worker — die er nog niet is.
**Keuze: het schema staat in de DB (single source of truth) en een licht scheduler-proces (`apps/scheduler`) pollt elke 60s sites waarvan `next_scan_at <= now()`, en start de scan (vandaag: inline; zodra de pipeline er is: enqueue `scan.dispatcher`).** De DB is dan ook wat de UI toont (volgende run) — geen dubbele waarheid met BullMQ-repeat-state.

## DB (migratie `004_scan_triggers.sql` in `packages/db`)

Uitbreiden `sites`:

- `scan_frequency text not null default 'none' check (scan_frequency in ('none','daily','weekly'))`
- `next_scan_at timestamptz` (nullable) — volgende geplande run (alleen relevant bij daily/weekly)
- `last_scan_at timestamptz` (nullable) — laatste scan-start, denormaliseerd (mirror van `last_scanned_at` uit plan 04)

Uitbreiden `scans`:

- `trigger text not null default 'manual' check (trigger in ('manual','schedule'))`
- `scheduled_for timestamptz` (nullable) — de geplande tijd (audit + notificaties)

> Let op migratie-nummers: plan 03 claimt `003`, plan 04 `002` (al bezet door `002_invitations`). Nummering bij merge afstemmen; `004` is de eerstvolgende vrije.

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/scans` | POST | ingelogd | Directe scan: `{ site_id }` → scans-rij (`trigger='manual'`) + scan starten (inline/enqueue), antwoord `202`; credit-check |
| `/api/scans` | GET | ingelogd | Scan-historie van team-sites (voor dashboard/sites-pagina) |
| `/api/sites/[id]/schedule` | PATCH | ingelogd | `{ frequency: 'none'\|'daily'\|'weekly' }` → `next_scan_at` berekenen; **Pro-gate** (Free → 403 + upsell-payload) |

## Scheduler (`apps/scheduler`, nieuw Node-proces)

Loop elke 60s:

1. Due sites ophalen: `select ... where scan_frequency != 'none' and next_scan_at <= now()`, per site met lock (`for update skip locked` of Redis-lock) tegen meerdere scheduler-instances
2. **Overlap-check**: geen nieuwe run als er al een `queued`/`running` scan voor die site is
3. **Credit-probe** (Feature 3 helper, non-blocking variant): bij limiet → run skippen + mail "scan overgeslagen wegens credit-limiet" (schema blijft actief)
4. scans-rij (`trigger='schedule'`, `scheduled_for = next_scan_at`) + scan starten (inline vandaag / enqueue later)
5. `next_scan_at` opschuiven: daily +1 dag, weekly +7 dagen — gerekend **vanaf de geplande tijd** (geen drift); altijd op 09:00 UTC (vast), tenzij `next_scan_at` ruim achterloopt → dan opnieuw plannen vanaf de eerstvolgende 09:00 UTC

**Missed runs**: als de scheduler beneden was, draait de run alsnog bij de eerstvolgende poll (geen overslaan). Mislukte scan (site down): markeren als `failed`, volgende run volgt per schema — uptime-monitoring is een eigen feature.

**Notificatie na voltooide geplande scan**: score vergelijken met de vorige scan van die site; bij daling of `failed` → mail via `lib/email.ts` (Resend). Alleen bij geplande scans, niet bij handmatige.

## Credit + gating

- Directe én geplande scans kosten 1 credit (Feature 3 atomic check)
- Scheduling (daily/weekly) is **Pro-only** — `PATCH /api/sites/[id]/schedule` geeft op Free-plan `403` + upsell-payload
- Directe scans op Free-plan toegestaan (binnen credit-limiet)

## UI

- Sites-pagina (plan 04): per rij "Scan nu"-knop + schema-select (Geen / Dagelijks / Wekelijks) + "Volgende run"-datum (09:00 UTC, lokaal weergegeven); Pro-label bij de schema-select voor free-users
- Zolang plan 04 er niet is: minimale plek op de dashboard-pagina (scan-knop + schema-dropdown per site)
- `402`-handling hergebruiken (upsell-modaal uit Feature 3); scheduling-keuze bij Free-plan → Pro-upsell
- Scan-historie (optioneel): lijst van recente scans per site op de sites-pagina

## Stappen

1. Migratie `004_scan_triggers.sql` + shared zod schema's (`scanFrequencySchema`, `scanTriggerInputSchema`, `siteScheduleSchema`, `scanHistorySchema`)
2. `POST /api/scans` (direct) + authz (eigen team) + credit-check (koppeling zodra Feature 3 klaar is)
3. `PATCH /api/sites/[id]/schedule` + `next_scan_at`-berekening in `lib/schedule.ts` (09:00 UTC, getest) + Pro-gate
4. `apps/scheduler`: poll-loop + locks + overlap-check + credit-skip + notificatie-mails (score-daling/mislukt, credit-skip); opnemen in docker-compose
5. UI: knoppen + schema-select + volgende-run-weergave
6. Tests: `next_scan_at`-berekening (daily/weekly, drift-correctie, 09:00 UTC), overlap-voorkoming, credit-limiet-skip + mail, Pro-gate op schedule-route, rechten (alleen eigen team), directe trigger-flow, missed-run na downtime, notificatie bij score-daling

## Open vragen

- ~~Plan-gating~~ → opgelost: Pro-only
- ~~Scheduler-aanpak~~ → opgelost: DB-gedreven
- ~~Tijdstip/tijdzone~~ → opgelost: 09:00 UTC vast
- ~~Credit-limiet~~ → opgelost: skip + mail
- ~~Notificaties~~ → opgelost: alleen bij daling/mislukt
- ~~Moet `GET /api/scans` (historie) nu mee, of pas bij de sites-pagina (plan 04)?~~ → opgelost: meegeleverd

## Acceptatiecriteria

- [x] "Scan nu" start direct een scan; voortgang te volgen via poll (bestaand mechanisme)
- [x] Per site dagelijks/wekelijks instelbaar; "volgende run" zichtbaar in UI
- [x] Geplande runs draaien op tijd; nooit twee lopende scans voor dezelfde site tegelijk
- [x] Geplande run kost een credit; bij limiet skip + mail, schema blijft actief
- [x] Alleen teamleden kunnen scans triggeren en schema's wijzigen (eigen team)
- [x] Missed runs (scheduler down) worden ingehaald in plaats van overgeslagen
- [x] Scheduling Pro-gated: Free-plan krijgt upsell, geen daily/weekly-keuze
- [x] Mail bij score-daling of mislukte geplande scan; geen mail bij handmatige scans
