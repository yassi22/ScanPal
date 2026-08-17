# Plan: 8 AGENTS.md-bestanden met architectuur-diagrammen + scan-pipeline

**Doel**: Elk onderdeel van de monorepo een eigen AGENTS.md geven, zodat agents context dicht bij de code vinden: scope, laagspecifiek architectuur-diagram, scan-pipeline-detail, contracts, commands en conventies. De root `AGENTS.md` wordt de index (en blijft bron van waarheid voor het totaalbeeld).

**Status**: ✅ Klaar (2026-08-16) — alle 8 AGENTS.md-bestanden staan, README koppelt naar de index.

## Besluiten (bevestigd 2026-08-15)

1. **8 bestanden** volgens onderstaande tabel (mijn voorstel); docs/ en deploy/ krijgen ook een AGENTS.md
2. **Taal**: Engels voor alle sub-AGENTS.md (consistent met root); docs/plans blijven Nederlands
3. **Toekomstige dirs**: `apps/worker` en `packages/mcp-server` bestaan nog niet → hun AGENTS.md wordt nu al geschreven als blueprint (dir wordt vanzelf aangemaakt)
4. **FEATURES.md**: bijwerken met de nieuwe plan-nummers (07, 08–11, 27+, 50, 51) en ROADMAP-koppeling; inhoud wijzigt verder niet. ~~Omdat dit plan nummer 07 claimt, schuiven de beloofde feature-plannen op: 08-resultaten-score, 09-findings, 10-export, 11-trends~~ → afwijkend uitgevoerd: 08/09/10 zijn klaar, maar **11 is naar 11-uptime-dashboard gegaan** (dekt 11, 24, 50); trends (feature 10) blijft open ("te schrijven", zie ROADMAP-opmerking)
5. **Scan-pipeline blijft gecentraliseerd**: root = overzicht (5 stappen), worker = detail (fan-out, retry, aggregatie); web = SSE-contract (plan 06)

## De 8 bestanden

| # | Bestand | Status | Scope | Diagram |
|---|---|---|---|---|
| 1 | `AGENTS.md` (root) | bestaat → uitbreiden | Index naar alle sub-AGENTS, core rules, scan-pipeline-overzicht, data-model | al aanwezig (geheel) |
| 2 | `apps/web/AGENTS.md` | nieuw | Frontend + REST routes: route-tabel, auth/rollen, credit-afdwinging, SSE-contract, inline-modus | Webapp → API-routes → Queue/DB |
| 3 | `apps/worker/AGENTS.md` | nieuw (dir nog leeg) | Dispatcher fan-out, check-catalog, aggregatie/score, retry/timeout, Redis-locks, progress-writes, uptime-poller | Dispatcher → sub-jobs → checks → DB |
| 4 | `packages/shared/AGENTS.md` | nieuw | Check-catalog, zod-schema's (progress, findings, events), enums, scoring | Shared in het midden |
| 5 | `packages/db/AGENTS.md` | nieuw | Migraties, tabellen, JSONB-vereisten, indexen, claim-volgorde | Tabel-relaties |
| 6 | `packages/mcp-server/AGENTS.md` | nieuw (dir nog leeg) | Tools, REST-wrapper, API-key-auth, tool-schema's | MCP → REST → webapp |
| 7 | `docs/AGENTS.md` | nieuw | Plan/roadmap-conventies, nummering, status-flow (💡→📝→🚧→✅) | — |
| 8 | `deploy/AGENTS.md` | nieuw (dir nog leeg) | docker-compose, VPS + nginx, env-vars, secrets, back-ups | Containers + netwerk |

## Gemeenschappelijke structuur per AGENTS.md

Elke file (behalve docs/):

1. **Purpose** — wat dit onderdeel doet, in 2–3 zinnen
2. **Architecture** — klein ASCII-diagram van de laag (verwijst voor het totaalbeeld naar root)
3. **Key contracts** — de interfaces waar andere lagen op bouwen (links naar plannen)
4. **Rules & conventions** — laagspecifiek, alleen wat niet al in root staat
5. **Commands** — dev/test/lint voor deze laag

## Stappen

1. Plan 07 opslaan + root `AGENTS.md` uitbreiden met index-sectie ("Agent navigation")
2. `packages/shared/AGENTS.md` + `packages/db/AGENTS.md` (kleinste scope, contract-leveranciers)
3. `apps/web/AGENTS.md` (route-tabel + SSE-contract + inline-modus)
4. `apps/worker/AGENTS.md` (scan-pipeline-detail + check-conventie)
5. `packages/mcp-server/AGENTS.md` + `deploy/AGENTS.md`
6. `docs/AGENTS.md` (conventies voor FEATURES/ROADMAP/plans)
7. `docs/FEATURES.md` bijwerken (plan-kolom: 08–11, 27+, 50, 51; status-koppeling) + ROADMAP plan-overzicht + README-koppeling naar de AGENTS-index

## Acceptatiecriteria

- [x] 8 AGENTS.md-bestanden aanwezig, elk met scope + (waar relevant) architectuur-diagram + commands
- [x] Root AGENTS.md indexeert alle 8 met één regel scope per file
- [x] Scan-pipeline: root heeft het 5-stappen-overzicht, worker het detail (fan-out/retry/aggregatie), web het SSE-contract — geen dubbelheid
- [x] Check-conventie staat consistent in worker + shared ("nieuwe check = catalog-entry + implementatie")
- [x] Featues in FEATURES.md verwijzen naar de nieuwe plan-nummers; ROADMAP-overzicht toont 07-agents-md
- [x] Taal: sub-AGENTS in het Engels, docs/plans in het Nederlands
