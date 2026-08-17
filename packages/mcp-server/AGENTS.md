# packages/mcp-server — AGENTS.md

MCP server (`@modelcontextprotocol/sdk`) exposing ScanPal as tools to
AI agents/IDEs. It is a **thin wrapper over the REST API** — it never talks
to the database or queue directly.

Live sinds plan 14 (feature 51): stdio-transport, tools uit
`packages/mcp-server/src/server.ts`, HTTP-client met bearer-key uit
`src/client.ts` (geen businesslogica). Zie `packages/mcp-server/README.md`
voor run/curl/MCP-config.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  MCP CLIENT (Claude, editors, agents)                         │
│  calls tools: run_scan, get_scan, get_findings,              │
│              list_sites, get_uptime                           │
└──────────────────────────┬───────────────────────────────────┘
                           ▼  JSON-RPC over stdio/HTTP
┌──────────────────────────────────────────────────────────────┐
│  packages/mcp-server                                         │
│  tool schemas (zod) → HTTP client → REST API of the webapp   │
│  auth: API key in Authorization header (`Bearer sp_live_…`)  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
                    webapp REST API (apps/web)
```

## Tools (feature 51)

| Tool | REST call | Purpose |
|---|---|---|
| `run_scan` | `POST /api/scans` | start a scan for a site, return scan id |
| `get_scan` | `GET /api/scans/[id]` | status, progress, scores |
| `get_findings` | `GET /api/findings?scan_id=…` | findings with severity/category filters |
| `list_sites` | `GET /api/sites` | sites of the team |
| `get_uptime` | `GET /api/uptime` | current status + metrics per site |

> Contract (plan 11, geleverd): `GET /api/uptime` → `{ sites: UptimeSummary[] }`
> per site `{ site_id, url, label, uptime_state, uptime_state_changed_at,
> uptime_enabled, uptime_24h_pct, uptime_30d_pct, avg_latency_ms_24h,
> p95_latency_ms_24h, sparkline[] }` (schema `uptimeSummarySchema` in
> `packages/shared`); detail via `GET /api/uptime/sites/[id]?days=30|90` →
> `uptimeDetailSchema` (series + recent_events + last_incident).

## Rules

- One tool = one REST endpoint; no business logic in the MCP layer.
- Tool input/output schemas come from `packages/shared` where possible — the
  MCP server maps them to the REST contract, it does not redefine it.
- Auth is **per-team**: an API key identifies a team; the REST API enforces
  scoping (MCP passes the key through, never overrides it).
- Key is sent via `Authorization: Bearer <key>` (statische `sp_live_`-key,
  feature 25/plan 14); HMAC signing is een latere uitbreiding — keep the
  client abstracted (`src/client.ts`) so the auth mode is swappable.
- Errors: map HTTP status → tool error (404 → "site/scan not found",
  401/403 → auth failure, 202 → "scan started, use get_scan to poll").

## Commands

```bash
pnpm --filter mcp-server dev       # stdio or HTTP transport
pnpm --filter mcp-server typecheck
pnpm --filter mcp-server test
```
