# ScanPal MCP-server

MCP-server (`@modelcontextprotocol/sdk`) die ScanPal als tools exposeert aan
AI-agents en editors. De server is een **dunne wrapper over de REST API** —
er zit geen businesslogica in, alleen de `Authorization: Bearer` header.
Tool-definities (naam, beschrijving, schema's) liggen in
`packages/shared/mcp-tools.ts`; de REST-mapping in `src/server.ts`.

## Tools (feature 51 + 63: 14 tools)

### Scans

| Tool | REST-call | Doel |
|---|---|---|
| `run_scan` | `POST /api/scans` | scan starten, retourneert scan-id |
| `get_scan` | `GET /api/scans/[id]` | status, progress, scores (poll tot `completed`) |
| `list_scans` | `GET /api/scans?site_id=…` | scan-historie van het team (optioneel per site) |
| `get_scan_diff` | `GET /api/scans/[id]/diff` | diff t.o.v. de laatste schone snapshot (plan 59) |
| `generate_fix_prompt` | `GET /api/scans/[id]/fix-prompt` | één copy-paste AI fix-prompt voor alle open findings (plan 60) |

### Findings

| Tool | REST-call | Doel |
|---|---|---|
| `list_findings` | `GET /api/scans/[id]/findings` | findings met alle filters (severity/category/status/route_url/q) + pagination (max 50) |
| `get_findings` | `GET /api/scans/[id]/findings` | compacte filters (severity/category/status/q/limit/offset) |
| `get_finding` | `GET /api/scans/[id]/findings/[findingId]` | finding-detail (beschrijving, evidence, remediatie, status) |
| `dismiss_finding` | `PATCH /api/scans/[id]/findings/[findingId]` | markeer `fixed`/`ignored` + notitie — **de enige schrijftool** |

### Sites & monitoring

| Tool | REST-call | Doel |
|---|---|---|
| `list_sites` | `GET /api/sites` | sites van het team met status |
| `get_site` | `GET /api/sites/[id]` | site-detail (status, last-scan, uptime-state, scan-frequency) |
| `get_uptime` | `GET /api/uptime` | uptime-status + metrics per site |
| `get_uptime_history` | `GET /api/uptime/sites/[id]?days=30\|90` | series, recente events en laatste incident per site |

### Catalogus

| Tool | REST-call | Doel |
|---|---|---|
| `list_checks` | — (leest `packages/shared` check-catalog) | alle checks die een scan uitvoert (id, categorie, naam, active) |

## Progress (plan 63, besluit 4)

De MCP-server kent geen streaming-protocol: de client pollt `get_scan`
zolang `status` = `running`/`queued`. Voorbeeld:

```
1. run_scan({ site_id })        → { scan: { id: "…" } }
2. get_scan({ id })             → { status: "running", progress: 42, … }
3. … herhaal stap 2 elke ~3s tot status = "completed" | "failed" | "canceled"
4. list_findings({ scan_id })   → findings van de voltooide scan
```

## Pagination

`list_findings` accepteert `limit` (max **50** per call, default 50) en
`offset` (default 0) — de REST-contract-filters van plan 09, met de
plan-63-cap van 50.

## API-key

- Maak een key in de webapp: **Settings → API-keys** (alleen de team-owner).
  De key is team-scoped: één key = toegang tot het hele team.
- De server stuurt de key mee als `Authorization: Bearer sp_live_...`.

## Omgeving

| Variabele | Default | Beschrijving |
|---|---|---|
| `SCANPAL_API_KEY` | — (verplicht) | API-key uit de webapp |
| `SCANPAL_API_URL` | `http://localhost:3000` | Basis-URL van de ScanPal-webapp |

## Run

```bash
SCANPAL_API_KEY=sp_live_... SCANPAL_API_URL=http://localhost:3000 pnpm --filter mcp-server dev
```

## Curl-voorbeeld (zelfde contract als de tools)

```bash
# Sites van je team
curl -H "Authorization: Bearer sp_live_..." http://localhost:3000/api/sites

# Scan starten
curl -X POST -H "Authorization: Bearer sp_live_..." \
  -H "Content-Type: application/json" \
  -d '{"site_id":"<uuid>"}' http://localhost:3000/api/scans

# Findings met filters
curl -H "Authorization: Bearer sp_live_..." \
  "http://localhost:3000/api/scans/<scan-id>/findings?severity=critical&status=open"

# Finding dismissen (de enige schrijftool)
curl -X PATCH -H "Authorization: Bearer sp_live_..." \
  -H "Content-Type: application/json" \
  -d '{"status":"ignored","note":"bewuste keuze"}' \
  "http://localhost:3000/api/scans/<scan-id>/findings/<finding-id>"
```

## MCP-client configuratie (bijv. Claude Code)

```json
{
  "mcpServers": {
    "scanpal": {
      "command": "pnpm",
      "args": ["--filter", "mcp-server", "start"],
      "env": {
        "SCANPAL_API_KEY": "sp_live_...",
        "SCANPAL_API_URL": "https://app.scanpal.nl"
      }
    }
  }
}
```

## Commands

```bash
pnpm --filter mcp-server dev        # stdio transport
pnpm --filter mcp-server test
pnpm --filter mcp-server typecheck
```
