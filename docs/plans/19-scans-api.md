# Plan: Scans-routes (create / get / list / cancel) + findings-API

**Doel**: Feature 19 (scans — create 202 + job, get progress, list, cancel) compleet
maken en feature 20 (findings — query met filters, mark fixed/ignored) registreren.
Create/get/list bestaan al (plannen 05/06); dit plan levert de ontbrekende
**cancel**-functionaliteit en legt het scans-API-contract vast in `packages/shared`.

**Status**: ✅ Klaar (2026-08-16) — create/get/list ✅ uit plannen 05/06; **cancel** gebouwd (dit plan). Feature 20 is ✅ klaar via `09-findings.md` (geen nieuw werk).

## Besluiten (bevestigd 2026-08-16)

1. **Endpoint**: `POST /api/scans/[id]/cancel` (action-endpoint) — de scan-rij blijft
   behouden voor historie/audit; alleen `status` verandert naar `canceled`
2. **Statusnaam**: `canceled` (één L — consistent met billing `canceled` /
   `cancel_at_period_end` in dit codebase) in `scanStatusSchema` (sites.ts) + DB-check-constraints
3. **Cancelbare statussen**: `queued` én `running`. `finishScan`/de aggregator (Fase 3)
   overschrijft een `canceled` scan **nooit** naar `completed`/`failed` — lost de race op
   (inline-probe die nog draait / worker die de job oppakt terwijl de cancel binnenkomt)
4. **Credit-refund**: bij cancel −1 credit (`credits_used − 1` + `credit_transactions`-rij
   met `amount = -1`, `reason = 'scan_cancel'`, zelfde `scan_id`); **idempotent** — refund
   alleen als er een `amount = 1`-rij met die `scan_id` bestaat
5. **Site-status bij cancel**: `setSiteScanState` met `last_scan_status = 'canceled'`,
   `last_scanned_at = now()`; `last_scan_score` behouden (coalesce) — de site is daarna
   weer vrij voor een nieuwe scan (overlap-check: `queued`/`running` blokkeren alleen actieve scans)
6. **Rechten**: elke teamlid (owner én member) — zelfde authz als `GET /api/scans/[id]`
   (membership-join; geen match → `404`, niet ingelogd → `401`; geen existence-leak)
7. **SSE**: nieuw `canceled`-event in `scanProgressEventSchema`; de stream sluit bij
   `canceled` (zodat de UI niet blijft poll-fallbacken); hook behandelt het als terminale staat
8. **Dubbele cancel / terminale status**: POST /cancel op `completed`/`failed`/`canceled` → `409`
9. **UI**: cancel-knop op `/scans/[id]` tijdens `queued`/`running` (bevestigingsdialoog);
   bij `canceled` een "Geannuleerd"-banner + "Opnieuw scannen"-knop. Geen cancel-knop op de sites-pagina (historie-rijen tonen status wel)

## Uitgangssituatie (code vandaag)

- `POST /api/scans` (`apps/web/app/api/scans/route.ts`): `createManualScan`
  (`apps/web/lib/scans-core.ts`) — site-ownership-check, overlap-`409`, credit atomair
  (`spendCredit`), antwoord `202` (queue-modus) of `200` (inline, direct voltooid); `402` + upsell bij credit-limiet
- `GET /api/scans`: `listScanHistory` (limit 100, optioneel `site_id`-filter)
- `GET /api/scans/[id]`: scan met status/progress/score/findings, team-authz (membership-join)
- `GET /api/scans/[id]/stream`: DB-gedreven SSE (plan 06); terminale events `completed`/`failed`
- **Geen cancel**: geen `canceled` in `scanStatusSchema` (sites.ts:78) noch in de
  DB-check-constraints (scans migratie 001:46, sites.last_scan_status migratie 006:7);
  geen cancel-helper, geen route, geen SSE-event, geen UI-knop
- `spendCredit` (`apps/web/lib/credits.ts`) schrijft `credit_transactions` (`amount = 1`);
  er is nog geen refund-mechanisme

## Contract (`packages/shared`)

- `scanStatusSchema` uitbreiden met `"canceled"` (sites.ts:78) — werkt door in
  `scanSchema`, `scanListItemSchema`, `siteWithStatusSchema.last_scan_status` en de
  lokale rijtypes in `scans-core`/stream-route
- `scanProgressEventSchema` (scan-progress.ts): nieuwe variant
  `{ event: 'canceled', scan_id, status: 'canceled' }`
- Geen nieuwe input-schema's: `POST /api/scans/[id]/cancel` heeft geen body; de route
  retourneert de bijgewerkte scan (zelfde vorm als `scanCreateResponseSchema`)

## DB (migratie `013_scan_cancel.sql` in `packages/db` — volgende vrije nummer)

```sql
alter table scans drop constraint scans_status_check;
alter table scans add constraint scans_status_check
  check (status in ('queued', 'running', 'completed', 'failed', 'canceled'));

alter table sites drop constraint sites_last_scan_status_check;
alter table sites add constraint sites_last_scan_status_check
  check (last_scan_status in ('queued', 'running', 'completed', 'failed', 'canceled'));
```

> Constraint-namen zijn Postgres-defaults (`scans_status_check`, `sites_last_scan_status_check`)
> — bij implementatie bevestigen met `pg_get_constraintdef` vóór merge (plannen 04/06
> claimden `002`/`005`; `013` is de eerstvolgende vrije in de huidige map).

## API route: `POST /api/scans/[id]/cancel`

- Authz: `requireTeam` + scan JOIN sites JOIN team (idem `GET /api/scans/[id]`) → `401`/`404`
- Binnen één transactie (client):
  1. scan ophalen met `for update` (lock tegen gelijktijdige finish/cancel)
  2. status-check: alleen `queued`/`running` → anders `409` ("Scan is al afgerond")
  3. `update scans set status = 'canceled'` (+ `completed_at` blijft null)
  4. `setSiteScanState(client, siteId, { scanId, status: 'canceled' })`
  5. `refundCredit(client, { teamId, scanId })` (idempotent, zie Besluit 4)
- Response `200` met de bijgewerkte scan; dubbele cancel → `409`

## Credits-helper (`apps/web/lib/credits.ts`)

`refundCredit(client, { teamId, scanId })`:
- bestaat een `credit_transactions`-rij met `amount = 1` en deze `scan_id`? → anders no-op (idempotent)
- `update subscriptions set credits_used = greatest(credits_used - 1, 0)` (min 0)
- `insert into credit_transactions (team_id, amount, reason, scan_id) values ($1, -1, 'scan_cancel', $2)`
- Unit-tests: refund-na-flow, dubbele cancel-refund = één keer, credits_used klemt op 0

## Race-guard (`apps/web/lib/scans-core.ts`)

- `finishScan`: vóór de `completed`/`failed`-UPDATE de huidige status lezen; is die
  `canceled` → return early (geen overwrite, geen site-state-wijziging)
- `cancelScan(db, { teamId, scanId })`-helper met bovenstaande transactie; de
  BullMQ-aggregator (Fase 3) gebruikt `finishScan` en erft de guard automatisch

## SSE + UI

- Stream-route: bij `status = 'canceled'` → `canceled`-event sturen, stream sluiten
- Hook `useScanProgress`: `canceled` als terminale eindstaat (geen poll-fallback)
- `/scans/[id]`: cancel-knop (met bevestiging) tijdens `queued`/`running`; bij terminale
  `canceled`: banner "Scan geannuleerd" + "Opnieuw scannen"-knop
  (koppelt via bestaande `POST /api/scans`)

## Stappen

1. `packages/shared`: `scanStatusSchema` + `canceled`; `scanProgressEventSchema` + `canceled`-variant; tests (status-validatie, event-contract)
2. Migratie `013_scan_cancel.sql`: beide check-constraints uitbreiden; constraint-namen verifiëren
3. `credits.ts`: `refundCredit` (idempotent) + tests
4. `scans-core.ts`: `cancelScan` + `finishScan`-guard + tests (flow, dubbel-cancel 409, race cancel→finish blijft canceled, overlap vrij na cancel)
5. Route `POST /api/scans/[id]/cancel` + tests (401/404 authz, 409 terminale status, 200 flow + refund)
6. Stream-route `canceled`-event + hook-update + UI-knop/banner op `/scans/[id]`
7. FEATURES.md (19 → `19-scans-api`, status 🚧) + ROADMAP-plan-overzicht bijwerken

## Open vragen

- ~~Endpoint-vorm~~ → opgelost: `POST /api/scans/[id]/cancel` (Besluit 1)
- ~~Cancelbare statussen / race~~ → opgelost: queued+running, finish faalt op canceled (Besluit 3)
- ~~Credit bij cancel~~ → opgelost: refund −1, idempotent (Besluit 4)
- ~~Site-status bij cancel~~ → opgelost: `last_scan_status = 'canceled'`, score behouden (Besluit 5)
- ~~`cancelled` vs `canceled`~~ → opgelost: `canceled` (consistent met billing)
- ~~Constraint-namen bestaande migraties~~ → bevestigd: Postgres-defaults
  `scans_status_check` (migratie 001, unnamed check) en
  `sites_last_scan_status_check` (migratie 006, unnamed check) — zelfde
  patroon als migraties 011/012

## Acceptatiecriteria

- [x] `POST /api/scans/[id]/cancel` zet `queued`/`running` → `canceled` en retourneert de scan (`200`); terminale status → `409`; niet-lid → `404`; niet ingelogd → `401`
- [x] Gecancelde scan geeft de credit terug (`credits_used − 1`, `credit_transactions` `amount = -1`); dubbele cancel = géén dubbele refund; `credits_used` klemt op 0
- [x] `finishScan`/aggregator overschrijft een gecancelde scan nooit naar `completed`/`failed` (race: cancel tijdens draaiende inline-probe / opgepakte queue-job)
- [x] `last_scan_status = 'canceled'` + `last_scanned_at` bijgewerkt; score behouden; een nieuwe scan kan direct starten (overlap-check telt canceled niet als actief)
- [x] SSE stuurt een `canceled`-event en sluit; UI toont "Geannuleerd" + herscan-knop en een cancel-knop tijdens `queued`/`running`
- [x] Contract (`scanStatusSchema`, `canceled`-event) ligt in `packages/shared`; migratie `013`; FEATURES.md (19) en ROADMAP-plan-overzicht bijgewerkt
- [x] Feature 20: geregistreerd als ✅ via `09-findings.md` (geen nieuw werk)