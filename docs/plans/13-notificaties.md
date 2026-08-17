# Plan: Notificatiehub — mail + in-app centrum

**Doel**: Centrale notificatiehub (feature 13): alle scan/uptime/finding-events leiden tot e-mail (Resend) én in-app meldingen met per-user voorkeuren, dedup en een notificatiepagina. Vervangt de losse scheduler-mails.

**Status**: ✅ klaar (2026-08-16)

## Besluiten (bevestigd 2026-08-16)

1. **Kanalen**: e-mail (Resend) + **in-app centrum** (bel-badge in dashboard-nav + `(dashboard)/notifications`-pagina). Geen digest in v1.
2. **Events**: scan-done, score-drop, site-down/hersteld, kritieke finding, credit-skip/scan-failed (de 3 bestaande scheduler-mails gaan door de hub).
3. **Ontvangers**: per-user toggles per event-type (default aan); de team-owner kan per type team-breed uitzetten. Voorkeuren in DB. — ~~team-breed uitzetten~~ → v1 alleen zichzelf (team-breed later in settings).
4. **Dedup**: site-down 1× per incident (state-transition up→down na 2 failures / down→up; de 2-failure-regel blijft in de poller); per scan max 1 melding per type; unieke `dedup_key` in DB voorkomt dubbele send bij retries.
5. **Hub als nieuw pakket `packages/notify`**: nu zijn er drie consumers (webapp, scheduler, worker) — een gedeeld pakket voorkomt de plan-05-duplicatie die anders 3× gekopieerd wordt.
6. Migratie **`009_notifications.sql`** (008 = plan 14; afgestemd bij merge).
7. ~~Defaults per type?~~ → scan-done **uit**, alle andere types **aan**.
8. ~~Opschonen?~~ → cron in de scheduler verwijdert notificaties ouder dan 90 dagen.

## Uitgangssituatie (code vandaag)

- `apps/scheduler/src/email.ts` stuurt 3 mails (credit-skip, scan-failed, score-drop) rechtstreeks naar alle teamleden — geen voorkeuren, geen tabel, geen UI, geen dedup.
- Geen `notifications`-tabel in de DB (wel in het AGENTS.md-diagram genoemd).
- Uptime-poller (plan 11 ✅) heeft de 2-failure-regel maar stuurt nog geen alerts.
- Fase 3 (worker-pipeline) bestaat nog niet; scan-done/kritieke-finding events worden v1 opgehangen in de webapp-scan-flow, later in de dispatcher-finish-handler.

## Contract / DB / API

**Migratie 009**:
- `notification_preferences` (user_id FK, type, enabled bool, PK(user_id, type))
- `notifications` (id, team_id, user_id, type, title, body, link, payload JSONB, dedup_key unique, read_at, created_at) + indexes (user_id, read_at desc), (team_id, created_at desc)
- `dedup_key` = `{type}:{user_id}:{entityId}:{incidentId}` — site-down: incidentId = `uptime_state_changed_at`; scans: scan-id; unique-index garandeert 1× versturen

**packages/shared** (`notifications.ts`): `notificationTypeSchema` (scan_done, score_drop, site_down, site_recovered, critical_finding, credit_skip, scan_failed), `notificationPreferenceSchema`, `notificationViewSchema`.

**packages/notify** (nieuw pakket): `notify({ type, teamId, entityId, incidentId?, payload })` → recipients + voorkeuren opzoeken → dedup-check → `notifications`-rijen + Resend-mails (templates hergebruiken uit de scheduler). Waarde-/drempelbeslissingen (score-daling, kritiek) blijven bij de caller.

**API-routes** (`apps/web`):

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/notifications` | GET | ingelogd | lijst, filter unread/type, paginated |
| `/api/notifications/[id]/read` | POST | eigenaar | 1 markeren gelezen |
| `/api/notifications/read-all` | POST | ingelogd | alles gelezen |
| `/api/notifications/preferences` | GET/PATCH | ingelogd | per-user toggles |

**Aanhaken (events → hub)**:
- Scheduler: score-drop, credit-skip, scan-failed (vervangt `email.ts`)
- Uptime-poller: site-down (transition, na 2 failures) + site-recovered
- Webapp scan-flow: scan-done + critical_finding (bij scan-complete); Fase 3: zelfde calls in de dispatcher-finish-handler (contract verandert niet)

**UI**: bel-badge (ongelezen count, revalidation) in de dashboard-layout + `(dashboard)/notifications` (lijst, read/unread, mark-all-read, link naar scan/site) + `(dashboard)/settings/notifications` (toggles per type).

## Stappen

1. Migratie 009 + db-types + shared zod-schema's
2. `packages/notify` (recipients, voorkeuren, dedup, rows, Resend) + tests
3. Scheduler en uptime-poller ombouwen naar de hub (oude mails vervangen)
4. scan-done + kritieke-finding events in de webapp-scan-flow (Fase 3: finish-handler)
5. API-routes + tests (authz eigen team)
6. UI: bel + notificatiepagina + voorkeurenpagina
7. FEATURES.md + ROADMAP.md bijwerken

## Open vragen

- ~~Kanalen?~~ → mail + in-app (bevestigd 2026-08-16). ~~Events?~~ → 5 types (bevestigd). ~~Ontvangers?~~ → per-user toggles (bevestigd). ~~Dedup/digest?~~ → dedup 1× per incident, geen digest (bevestigd).
- ~~Defaults per type?~~ → score-drop/kritiek/site-down/credit-skip/scan-failed **aan**, scan-done **uit** (bevestigd 2026-08-16).
- ~~Owner team-breed uitzetten?~~ → v1 alleen zichzelf, team-breed later in settings (bevestigd 2026-08-16).
- ~~Opschonen?~~ → scheduler verwijdert meldingen > 90 dagen (bevestigd 2026-08-16).

## Acceptatiecriteria

- [x] Alle 5 event-types produceren mail + in-app melding met link naar de juiste scan/site
- [x] Per-user toggles werken (uit = geen mail én geen in-app); wijziging direct actief
- [x] Dedup: site-down 1× per incident tot herstel, daarna 1 recovery-mail; geen dubbele mails bij retries (unique dedup_key)
- [x] Bel-badge toont ongelezen; pagina biedt read / read-all / filter
- [x] Scheduler- en poller-mails lopen door de hub (geen dubbele verzending)
- [x] Tests, lint en typecheck groen
