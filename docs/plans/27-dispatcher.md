# Plan: Dispatcher — scan-pipeline (fan-out, aggregatie, retry/timeout, progress)

**Doel**: Feature 27 — de BullMQ-pipeline vervangt de inline probe. De webapp
enqueue-only (202); een `scan.dispatcher`-job fanned uit naar `scan.http` /
`scan.browser` / `scan.github`-sub-jobs; een aggregator berekent na afloop de
scores, schrijft findings/scores en finaliseert de scan. Legt de
pipeline-infra (queues, retry/timeout, DLQ, checks-tabel, gedeelde
scan-lifecycle-helpers) vast als fundament voor features 28–49.

**Status**: ✅ klaar (2026-08-17)

## Besluiten (bevestigd 2026-08-17)

1. **BullMQ-infra in `apps/worker`**: nieuwe dependency `bullmq`; queues
   `scan.dispatcher`, `scan.aggregate`, `scan.http`, `scan.browser`,
   `scan.github` (+ bestaande `uptime.check` later). `src/index.ts` boot alle
   consumers; Redis-config uit env (`REDIS_URL`). Architectuur-diagram in
   AGENTS.md wordt aangevuld met `scan.aggregate` en de `checks`-tabel.
2. **Fan-out via FlowProducer**: de dispatcher resolved de scan/site, schrijft
   het progress-skelet (progress 0) en maakt een flow aan: parent-job op
   `scan.aggregate`, children op `scan.http` + `scan.browser` (+ `scan.github`
   alleen als `sites.github_repo` aanwezig of expliciet gevraagd). De
   aggregator draait pas als álle children klaar zijn (BullMQ-flow-semantiek).
   Job-names = scanId (child: `{scanId}:{queue}`) → idempotent, geen
   dubbele runs.
3. **Nieuw package `packages/scan-core`**: de scan-lifecycle-DB-helpers uit
   `apps/web/lib` verhuizen naar een package dat zowel web als worker
   importeren — één bron van waarheid (zelfde grondhouding als het
   progress-contract): `finishScan` (+ race-guard), `setSiteScanState`,
   `advanceCategoryProgress` (atomair), `emitScanFinishedNotifications`,
   `spendCredit`/`refundCredit`, finding-status-carry-over
   (`finding-status.ts`). Pure math (`initialProgressDetails`,
   `advanceProgressDetails`, `overallProgress`, `summarizeFindings`) gaat naar
   `packages/shared` (zod-only, geen DB — regel uit shared/AGENTS.md). De web
   re-exporteert vanuit scan-core zodat de bestaande routes ongewijzigd
   blijven.
4. **Atomic progress**: workers schrijven voortgang via
   `advanceCategoryProgress(db, scanId, category, checkId, now)` — transactie
   met `select … for update` op de scans-rij, nieuwe details via de pure
   helper, één UPDATE. Idempotent (onbekende check / al-voltooide categorie →
   no-op). De single-threaded inline probe blijft `updateScanProgress`
   gebruiken; de workers gebruiken de locked variant. Contract-nuance:
   `current_check` wordt in queue-modus de zojuist voltooide check (niet
   "volgende in catalogus-volgorde", want checks draaien parallel).
5. **`checks`-tabel + DB-gedreven aggregatie**: elke check schrijft één rij in
   `checks` (idempotent upsert `on conflict (scan_id, check_id)`); findings
   worden **niet** per check in `scans.findings` gemerged (concurrent
   jsonb-writes op het items-array raken verloren). De aggregator bouwt de
   finale `findings`-payload uit de `checks`-rijen (mapper + carry-over uit
   plan 09), valideert met `findingsPayloadSchema`, berekent de scores
   (`categoryScoresFromFindings` + overall pass-ratio) en roept `finishScan`.
   Nieuwe kolom `scans.category_scores jsonb` (contract: `categoryScoresSchema`
   uit shared — plan 08/27 verwijzing in `scoring.ts`).
6. **Retry/timeout per queue** (voorstel; getallen afstemmen bij implementatie):
   dispatcher `attempts: 1` (geen auto-retry) · http `attempts: 3`, backoff
   5s/15s/45s, `lockDuration 120s` · browser `attempts: 2`, backoff 10s/30s,
   `lockDuration 300s` · github `attempts: 2`, backoff 30s/60s,
   `lockDuration 600s` · aggregate `attempts: 3`, `lockDuration 60s`. Na
   exhausted attempts → DLQ (`dlq.scan.*`). **Partial-failure-policy**: een
   sub-job die na exhausted attempts definitief faalt → de aggregator zet de
   hele scan op `failed` (consistent met het huidige gedrag; de ontbrekende
   categorie wordt niet als 'niet gescand' gecompenseerd).
7. **Routes → queue-modus**: `POST /api/scans`, `POST /api/onboarding/sites`
   en de scheduler enqueuen `scan.dispatcher` (`jobId = scanId`) en
   antwoorden altijd `202`. **Altijd queue-modus** — `runInlineProbe` /
   `runInlineProbeWithProgress` verdwijnen uit de routes (en worden verwijderd
   zodra de tests op de pipeline draaien); geen `SCAN_MODE`-fallback. De
   UI/SSE-contract uit plan 06 verandert niet — de workers schrijven dezelfde
   rij.
8. **Scope van 27 = pipeline, niet de checks**: de eerste checks
   (reachability, https, security-headers, meta-tags, secrets-in-bundles,
   actieve tests uit plan 52) verhuizen als `src/checks/`-implementaties naar
   hun queue (http-worker draait http+seo-categorie, browser-worker aeo,
   github-worker github) zodat de pipeline end-to-end werkt; features 28–49
   vullen de catalog verder in (conventie: check = catalog-entry + worker-impl).

## Uitgangssituatie (code vandaag)

- **Geen pipeline**: `apps/worker` bevat alleen de uptime-poller
  (`src/uptime/`); geen BullMQ-dependency in `apps/worker/package.json`
  (wel `ioredis` + `pg`).
- **Inline probe** in `apps/web/lib/scan-runner.ts` (`runInlineProbe`) draait
  de kern-checks; `apps/web/lib/scan-progress.ts` bevat
  `initialProgressDetails` / `advanceProgressDetails` / `overallProgress` /
  `updateScanProgress` / `summarizeFindings` + de hardcoded
  `INLINE_RUN_CHECKS`-lijst (imports `server-only` → worker kan dit niet
  importeren).
- **Scan-lifecycle** in `apps/web/lib/scans-core.ts`: `createManualScan`
  (transactie + probe buiten de transactie), `finishScan` (race-guard op
  `canceled`, carry-over, `setSiteScanState`), `cancelScan`,
  `emitScanFinishedNotifications`; `credits.ts` (`spendCredit`/`refundCredit`),
  `sites-core.ts` (`setSiteScanState`), `finding-status.ts` (carry-over).
- **Contract** in `packages/shared`: progress/event-schema's, check-catalog
  (incl. `active`-flag), `categoryScoresFromFindings`, findings-payload
  (v1), severity-helpers.
- **Geen `checks`-tabel** in de migraties (001–015); `scans` heeft nog geen
  `category_scores`-kolom. `scans.progress_details` wordt vandaag door de
  webapp geschreven; SSE (plan 06) leest dezelfde rij.
- **docker-compose**: services postgres, redis, scheduler, uptime-poller;
  nog geen pipeline-worker-service.

## Contract / DB / API

### DB (migratie `016_scan_pipeline.sql` — volgende vrije)

```sql
alter table scans add column category_scores jsonb;

create table checks (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  check_id text not null,
  category text not null check (category in ('http', 'seo', 'aeo', 'github')),
  status text not null check (status in ('pass', 'fail', 'warn', 'info', 'error')),
  severity text,                        -- afgeleid, uit findings-helpers
  finding jsonb,                        -- finding-payload van deze check
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (scan_id, check_id)
);
create index checks_scan_id_idx on checks (scan_id);
```

### Queue/job-contract

- `scan.dispatcher` — data `{ scanId }`, jobId = scanId. Processor: scan+site
  lezen (status, active_tests, site_url, github_repo, team_id), skelet
  schrijven (`progress = 0`, categorie-totalen uit de catalog, github-categorie
  0 zonder repo), FlowProducer-flow aanmaken. Fout (bijv. scan bestaat niet /
  al canceled) → log + geen flow; scan blijft zoals-ie is.
- `scan.aggregate` — data `{ scanId }` (flow-parent). Draait als alle children
  compleet zijn. Processor: checks-rijen ophalen → findings-payload bouwen →
  scores (overall + per-categorie, `scans.category_scores`) → `finishScan`
  (`completed`/`failed`, race-guard op canceled) → notificaties.
- `scan.http` / `scan.browser` / `scan.github` — data `{ scanId }`,
  job-name `{scanId}:{queue}`. Processor: scan-status checken (canceled →
  early exit), catalog-checks van de eigen categorie(ën) uitvoeren, per check:
  checks-rij upserten + `advanceCategoryProgress`. Categorieën per queue:
  http = http+seo, browser = aeo, github = github.
- Progress-skelet en event/payload-contract blijven uit plan 06 (`shared`);
  `category_scores` wordt de output-vorm uit `scoring.ts`.

### API

- Geen nieuwe routes. `POST /api/scans`, onboarding en scheduler switchen naar
  enqueue `scan.dispatcher` + `202`. UI leest bestaande `GET /api/scans/[id]`
  en SSE — ongewijzigd.

## Stappen

1. **Shared**: pure progress-math naar `packages/shared/scan-progress.ts`
   verhuizen (`initialProgressDetails` → pipeline-variant met catalog-totalen,
   `advanceProgressDetails`, `overallProgress`, `summarizeFindings`) + tests;
   `check-catalog` krijgt een helper voor de checks per queue-owner
   (`checksForQueue`) en unieke-id-test blijft.
2. **Package `packages/scan-core`** (nieuw): scan-lifecycle-helpers uit web
   verhuizen (finishScan, setSiteScanState, advanceCategoryProgress met
   `for update`, carry-over, credits, notifications) + `buildFindingsFromChecks`
   (checks-rijen → findings-payload). Web re-exporteert; routes onveranderd.
3. **Migratie `016_scan_pipeline.sql`**: `category_scores` + `checks`-tabel +
   index; constraint-namen verifiëren.
4. **Worker-infra**: `bullmq`-dependency; `src/queues/` (queue-definities,
   retry/backoff/lockDuration per queue, DLQ); `src/index.ts` boot alle
   consumers; `env.ts`-uitbreiding (`REDIS_URL`); package-scripts
   (`dev` = pipeline-worker, `uptime:start` blijft).
5. **Dispatcher-processor** + FlowProducer-flow (condit. github) + unit-tests.
6. **Sub-job-consumers** met de eerste `src/checks/`-implementaties (verhuisde
   inline-checks incl. active tests) + checks-upsert + atomic progress +
   canceled-early-exit + tests (incl. parallelle progress, idempotente
   upsert).
7. **Aggregator-processor**: checks → findings → scores → `finishScan` →
   notificaties; partial-failure-policy volgens Open vraag 5; tests
   (scoring, carry-over, canceled-guard, failed-path).
8. **Routes**: `POST /api/scans` + onboarding + scheduler enqueuen
   `scan.dispatcher`, altijd `202`; inline-aanroepen uit de routes; tests
   (mock-queue: jobId=scanId, 202, geen inline-uitvoering).
9. **docker-compose**: `worker`-service (pipeline-consumers) naast
   `uptime-poller`.
10. **E2E-integratietest** (redis + pg lokaal): enqueue → children draaien →
    progress naar 100 → aggregator finaliseert `completed` met overall- en
    per-categorie-scores; cancel-midden-in → `canceled` blijft staan.
11. **Docs**: AGENTS.md (root + worker: `scan.aggregate`-queue, checks-tabel,
    DB-gedreven aggregatie, pipeline-beschrijving), FEATURES.md (27 →
    `27-dispatcher`, 📝), ROADMAP (Fase 3 + plan-overzicht).

## Open vragen

1. ~~SSE vs polling~~ → opgelost (plan 06): DB-gedreven SSE; workers schrijven
   dezelfde rij, contract onveranderd.
2. ~~Fan-out/completie-detectie~~ → opgelost: BullMQ FlowProducer met
   `scan.aggregate` als parent (alternatief: Redis-teller + apart aggregate-job —
   verworpen: flow-semantiek is minder code en faalt-vrij).
3. ~~Concurrent jsonb-findings-writes~~ → opgelost: per-check `checks`-rijen;
   aggregator bouwt findings uit de tabel (Besluit 5).
4. ~~Inline probe: verwijderen of fallback?~~ → opgelost: altijd queue-modus;
   probe weg uit de routes, geen `SCAN_MODE`-fallback (Besluit 7).
5. ~~Partial failure: sub-job haalt retries niet~~ → opgelost: hele scan
   `failed` (Besluit 6).
6. ~~Waar leven de DB-helpers~~ → opgelost: nieuw `packages/scan-core` (Besluit 3).
7. ~~Checks-tabel nu of later~~ → opgelost: nu, migratie `016` (Besluit 5).

## Acceptatiecriteria

- [x] `POST /api/scans`, onboarding en scheduler enqueuen `scan.dispatcher`
      (`jobId = scanId`) en antwoorden `202`; de webapp voert geen scans meer
      inline uit.
- [x] Dispatcher resolved de site en maakt de juiste flow aan; github-sub-job
      alleen bij `github_repo`/expliciete aanvraag; skelet staat (progress 0,
      correcte categorie-totalen incl. 0-github zonder repo).
- [x] Workers schrijven per check een idempotente `checks`-rij en atomair
      progress; parallelle checks verliezen geen updates; progress eindigt op
      100.
- [x] Aggregator bouwt de findings-payload uit checks (validatie
      `findingsPayloadSchema`, carry-over), berekent overall + per-categorie
      scores en schrijft `scans.category_scores`; `finishScan` finaliseert en
      werkt `sites.last_scan_*` bij; notificaties worden ge-emit.
- [x] Gecancelde scans worden nooit overschreven (`canceled` blijft); children
      stoppen vroeg bij canceled.
- [x] Retry/timeout-policy per queue + DLQ; een sub-job die zijn attempts
      uitput → de scan eindigt `failed`.
- [x] Contract: progress-math + scoring in `packages/shared`, lifecycle in
      `packages/scan-core`, migratie `016`; FEATURES.md (27) en ROADMAP
      bijgewerkt; typecheck + tests groen.