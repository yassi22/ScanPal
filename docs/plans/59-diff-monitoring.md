# Plan: Diff-gebaseerde monitoring ("diffs, not dumps")

**Doel**: Geplande scans vergelijken met de laatste schone snapshot — in de UI een "wat is er veranderd"-view (nieuw / opgelost / teruggekeerd), alerts alleen bij daadwerkelijke verandering, detectie van "dismissed-then-returned" findings en snooze-rules op notificaties. Dit vervangt/uitbreidt de eenvoudige score-daling-mail uit plan 05 (CheckVibe: "every run is compared against your last clean snapshot — we surface what changed").

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-16)

1. **Snapshot-definitie**: een scan is "schoon" als er geen critical/high-findings open staan **of** de overall-score ≥ 80 (drempel afstemmen); de laatste schone scan is de referentie
2. **Diff-berekening in de dispatcher-finish** (27): per finding een stabiele fingerprint = hash van `check_id + rule-id + route_url + status`; uitkomsten: `new` (niet in snapshot), `resolved` (was er wel, nu niet), `unchanged`, en `regressed` (was ooit fixed/ignored én komt terug — feature 20/plan 09)
3. **Opslag**: `scans.diff jsonb` (`{ new: counts, resolved: counts, regressed: counts }` per ernst) + de diff-geselecteerde finding-id's; trends (10) kunnen dit later hergebruiken
4. **Alerts**: alleen bij `new`/`regressed` boven een ernst-drempel (≥ medium) of score-daling ≥ 5 punten; handmatige scans doen geen diff-mail (consistent met plan 05); notificatiehub (13) consumeert de diff
5. **Snooze**: per finding per site tijdelijk dempen (7/30 dagen of "tot volgende scan"), opgeslagen in de `notifications`/`findings`-state; gesnoozde findings tellen niet mee in diff-alerts maar wel in de view
6. **UI**: "Wijzigingen" tab op de resultatenpagina (nieuw/opgelost/teruggekeerd met badges), plus een what-changed-sectie in de maandelijkse/wekelijks-dashboard (Fase 4 uitbreiding)

## Uitgangssituatie (code vandaag)

- Plan 05 mailt alleen bij score-daling (trigger `schedule`); findings hebben `fixed`/`ignored`-state (feature 20, plan 09); dispatcher-aggregatie (27) berekent scores
- Geen fingerprint- of diff-logica; `scans` heeft geen diff-veld

## Contract / DB / API

- Migratie: `scans.diff jsonb not null default '{}'`; `findings.regressed bool default false` (of afleidbaar uit fingerprint-geschiedenis — keuze: expliciete vlag, makkelijker te queryen)
- Shared: `scanDiffSchema` (`{ new, resolved, regressed, unchanged }` per severity + `new_finding_ids`, `regressed_finding_ids`), `snoozeSchema`
- `GET /api/scans/[id]/diff` (authz als scans) → diff + geselecteerde findings
- `PATCH /api/findings/[id]` (plan 09) accepteert `snooze_until`
- Notificatiehub (13): nieuw eventtype `scan-diff`

## Stappen

1. Shared: fingerprint-helper (hash-functie, tests) + diff/snooze-schema's; migratie
2. Dispatcher-finish: snapshot-zoeken (laatste schone scan van die site), diff-berekening, `scans.diff` + `regressed`-flags schrijven
3. Notificatie: mail bij diff (drempel ernst ≥ medium of score-daling ≥ 5) — uitbreiding van de plan-05-mail
4. Snooze: PATCH-route + demping in de alert-logica + UI (per finding "snooze 7d/30d")
5. UI: Wijzigingen-tab met drie groepen en badges; koppeling met mark-fixed/ignored (plan 09)
6. Tests: fingerprint-stabiliteit, resolved/new/regressed-detectie, drempel-alerts, snooze-demping, handmatige scans geen mail

## Open vragen

- Fingerprint-stabiliteit bij kleine tekstwijzigingen in een finding (detailveld wisselt, rule blijft): rule-only of rule+detail-hash?
- "Schone snapshot" is dynamisch (laatste scan ≥ 80): wat als een site structureel onder de 80 zit — snapshot vervalt dan nooit en alles blijft "new" (alternatief: laatste scan als referentie met losse ernst-drempels?)
- Snooze en "mark as fixed" tegelijk: wat toont de what-changed-view bij beide?

## Acceptatiecriteria

- [ ] Elke geplande scan produceert een diff t.o.v. de laatste schone snapshot (new/resolved/regressed/unchanged per ernst)
- [ ] "Dismissed-then-returned" findings krijgen `regressed: true` en een badge "Teruggekeerd"
- [ ] Alerts alleen bij verandering boven de drempel; handmatige scans sturen geen diff-mail
- [ ] Snooze (7/30d) dempt alerts maar houdt de finding zichtbaar in de view
- [ ] Wijzigingen-tab toont nieuw/opgelost/teruggekeerd correct; `GET /api/scans/[id]/diff` werkt met dezelfde authz
