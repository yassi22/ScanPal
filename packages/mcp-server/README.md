# ScanPal MCP-server

MCP-server (`@modelcontextprotocol/sdk`) die ScanPal als tools exposeert aan
AI-agents en editors. De server is een **dunne wrapper over de REST API** —
er zit geen businesslogica in, alleen de `Authorization: Bearer` header.

## Tools (feature 51)

| Tool | REST-call | Doel |
|---|---|---|
| `run_scan` | `POST /api/scans` | scan starten, retourneert scan-id |
| `get_scan` | `GET /api/scans/[id]` | status, progress, scores (poll tot `completed`) |
| `get_findings` | `GET /api/scans/[id]/findings` | findings met filters (severity/category/status/q) |
| `list_sites` | `GET /api/sites` | sites van het team |
| `get_uptime` | `GET /api/uptime` | uptime-status + metrics per site |

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
