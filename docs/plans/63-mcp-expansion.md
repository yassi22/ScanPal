# Plan: MCP-server uitbreiden (tool-oppervlak + progress)

**Doel**: De MCP-server uitbreiden van 5 basis-tools (51) naar het volledige read-oppervlak plus een paar veilige schrijftools: findings-filters, finding-detail, dismiss/mark-fixed, scan-diff, site-detail, uptime-historie, scan-historie, fix-prompts en de check-catalog (CheckVibe: "24 tools — all scanner endpoints exposed as MCP tools").

**Status**: ✅ klaar (geïmplementeerd + getest, 2026-08-18).

## Besluiten (bevestigd 2026-08-16)

1. **Tool-set** (naast `run_scan`, `get_scan`, `get_findings`, `list_sites`, `get_uptime` uit 51): `list_findings` (filters ernst/categorie/status/route), `get_finding` (detail + fix_prompt), `dismiss_finding` (fixed/ignored + notitie), `get_scan_diff` (plan 59), `list_scans` (historie per site), `get_site`, `get_uptime_history`, `generate_fix_prompt` (plan 60), `list_checks` (catalog)
2. **Schrijftools beperkt**: `dismiss_finding` wel (mits plan 09 klaar is); site-crud, scan-cancel en webhook-setup niet — agents mogen lezen en findings afvinken, niets vernietigen
3. **1-op-1 REST-wrapper**: de tools roepen exact de REST-routes aan (route-tabel `apps/web/AGENTS.md`) en valideren met dezelfde shared zod-schema's — geen eigen logica in de MCP-server (bestaand principe uit 51)
4. **Progress zonder streaming-protocol**: de client pollt `get_scan` tijdens `running` (past bij de DB-gedreven SSE-houding van plan 06); MCP `notifications/progress` later als clients het ondersteunen
5. **Auth + limits**: HMAC-API-key (25) voor alle tools; per-team rate limiting (26); pagination (max 50 per call, `cursor`)
6. **BYOK blijft**: de server draait ook lokaal met een eigen key (config-pattern uit de CheckVibe-pagina als referentie)

## Uitgangssituatie (code vandaag)

- `packages/mcp-server` met 5 tools (51) over de REST-API; REST-routes komen er in Fase 2 (findings/scans) en Fase 4 (uptime); fix-prompts (60) en diff (59) zijn aparte plannen
- API-keys + HMAC (14/25) zijn Fase 5 — tot die tijd gebruiken de tools dezelfde sessie-auth als de routes (dev-modus)

## Contract / DB / API

- Tool-schema's in `packages/shared` (hergebruik van de REST zod-schema's; `mcp-tools.ts` met tool-definities + input/output per tool)
- Inputs: `site_id`/`scan_id`/`finding_id` + filters (`severity[]`, `category[]`, `status`), `cursor`, `limit`
- Outputs: de REST-responsen, onveranderd (MCP serialiseert; geen eigen response-modellen)
- README per tool: beschrijving, input-schema, voorbeeld (agent-readable)

## Stappen

1. Shared: `mcp-tools.ts`-registry (tool-definities) + pagination-schema + tests
2. `list_findings`/`get_finding` (wachten op REST van plan 09 — eerst tegen de geplande routes bouwen met TODO-markering)
3. `get_scan_diff`, `list_scans`, `get_site`, `get_uptime_history` (Fase 4-routes)
4. `dismiss_finding` + `generate_fix_prompt` (mits 09/60 klaar)
5. Progress-documentatie: client-voorbeeld met get_scan-polling tijdens `running`
6. Auth: HMAC-doorgave + rate limit (25/26) zodra die bestaan
7. E2E-tests: MCP-client (SDK) tegen een test-REST-mock; tool-count, filters, pagination, auth-fouten

## Open vragen

- Welke tools mogen in een latere fase wél schrijven (create-site, cancel-scan, webhook-setup) — veilig genoeg met expliciete confirm-tool?
- MCP-richting: onze eigen server of ook compatibel met remote-MCP-protocol (HTTP+SSE) voor Cloudflare Workers-achtige clients?
- ~~Notificatie-richting (server → client) bij scan-done: later via MCP-notifications of blijft polling het contract?~~ → opgelost in Besluit 4: polling van `get_scan` is het contract (MCP-notifications later als clients ze ondersteunen)

## Afwijkingen tijdens implementatie (t.o.v. het plan)

- **Tool-telling**: 14 tools = 6 bestaande (incl. `generate_fix_prompt`, al geleverd via plan 60) + 8 nieuwe (`list_findings`, `get_finding`, `dismiss_finding`, `get_scan_diff`, `list_scans`, `get_site`, `get_uptime_history`, `list_checks`). De "5 + 9" in de tekst dateerde van vóór plan 60; de acceptatie-eis "14+ tools" is met 14 exact gehaald.
- **Pagination zonder cursor**: besluit 5 noemt `cursor`, maar het REST-contract (plan 09 `findingsQuerySchema`) kent `limit`/`offset` — de tools volgen het REST-contract (1-op-1-regel) met `limit` gemaximeerd op **50** in het MCP-inputschema.
- **`list_checks` zonder REST-route**: er bestaat geen check-catalog-endpoint; de tool leest de catalog rechtstreeks uit `packages/shared` (single source of truth, pure data) — enige uitzondering op de 1-op-1-REST-regel, gedocumenteerd in AGENTS.md/README.
- **Twee nieuwe GET-handlers in de webapp**: `get_finding` en `get_site` hebben GET-handlers nodig die nog niet bestonden — toegevoegd aan `api/scans/[id]/findings/[findingId]` (via gedeelde `findPayload`-helper met PATCH) en `api/sites/[id]` (via nieuwe `getSite`-helper in `lib/sites-core.ts`), beide met tests.
- **`dismiss_finding`-scope**: alleen `status: fixed|ignored` + optionele `note` (geen `open`/snooze) — exact de toolbeschrijving uit Besluit 1.
- **Tool-definities in shared**: ook de 6 bestaande tools zijn verhuisd naar `packages/shared/src/mcp-tools.ts` (één registry); `packages/mcp-server/src/server.ts` bevat alleen de REST-mapping. De MCP-server draait nu op zod v4 (gelijk aan shared/web) met `@scanpal/shared` als dependency.
- **Rate limiting actief via de REST-API** (429 → leesbare tool-error in `client.ts`); HMAC-ondertekening blijft een latere uitbreiding (Besluit 6, swappable client).

## Acceptatiecriteria

- [x] 14 tools beschikbaar (6 bestaande + 8 nieuwe), allen 1-op-1 over de REST-API met gedeelde schema's (uitgezonderd `list_checks`, zie Afwijkingen)
- [x] Filters (ernst/categorie/status/route) en pagination werken; max 50 per call
- [x] `dismiss_finding` is de enige schrijftool; geen destructieve tools
- [x] Progress-werking: `get_scan`-polling tijdens `running` gedocumenteerd en werkend
- [x] Rate limiting van toepassing (429-mapping); HMAC volgt zodra 26 bestaat; BYOK blijft werken
