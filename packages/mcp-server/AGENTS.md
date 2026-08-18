# packages/mcp-server — AGENTS.md

MCP server (`@modelcontextprotocol/sdk`) exposing ScanPal as tools to
AI agents/IDEs. It is a **thin wrapper over the REST API** — it never talks
to the database or queue directly.

Live sinds plan 14 (feature 51), uitgebreid in plan 63: stdio-transport,
tools uit `packages/shared/src/mcp-tools.ts` (tool-definities),
HTTP-client met bearer-key uit `src/client.ts` (geen businesslogica). Zie
`packages/mcp-server/README.md` voor run/curl/MCP-config en het
get_scan-polling-voorbeeld voor progress.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  MCP CLIENT (Claude, editors, agents)                         │
│  calls tools: run_scan, get_scan, get_findings, list_findings,│
│  get_finding, dismiss_finding, get_scan_diff, list_scans,     │
│  list_sites, get_site, get_uptime, get_uptime_history,        │
│  generate_fix_prompt, list_checks (14 tools)                  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼  JSON-RPC over stdio/HTTP
┌──────────────────────────────────────────────────────────────┐
│  packages/mcp-server                                         │
│  REST-mapping (server.ts) → HTTP client (client.ts)          │
│  tool-definities + schema's uit @scanpal/shared/mcp-tools.ts │
│  auth: API key in Authorization header (`Bearer sp_live_…`)  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
                    webapp REST API (apps/web)
```

## Tools (feature 51 + 63)

| Tool | REST call | Purpose |
|---|---|---|
| `run_scan` | `POST /api/scans` | start a scan for a site, return scan id |
| `get_scan` | `GET /api/scans/[id]` | status, progress, scores (poll tot `completed`) |
| `get_findings` | `GET /api/scans/[id]/findings` | findings with severity/category/status/q filters |
| `list_findings` | `GET /api/scans/[id]/findings` | full filter-set (incl. `route_url`, sort/order) + pagination (max 50) |
| `get_finding` | `GET /api/scans/[id]/findings/[findingId]` | finding-detail (description, evidence, remediation, status) |
| `dismiss_finding` | `PATCH /api/scans/[id]/findings/[findingId]` | mark `fixed`/`ignored` + note — the only write tool |
| `get_scan_diff` | `GET /api/scans/[id]/diff` | diff t.o.v. de laatste schone snapshot (plan 59) |
| `list_scans` | `GET /api/scans?site_id=…` | scan-history, optioneel per site |
| `list_sites` | `GET /api/sites` | sites of the team |
| `get_site` | `GET /api/sites/[id]` | site-detail with status (plan 63) |
| `get_uptime` | `GET /api/uptime` | current status + metrics per site |
| `get_uptime_history` | `GET /api/uptime/sites/[id]?days=30\|90` | series + events + last incident per site |
| `generate_fix_prompt` | `GET /api/scans/[id]/fix-prompt` | één copy-paste AI fix-prompt voor alle open findings (plan 60) |
| `list_checks` | — | check-catalog rechtstreeks uit `packages/shared` (geen REST-route) |

> Contract (plan 11, geleverd): `GET /api/uptime` → `{ sites: UptimeSummary[] }`
> per site `{ site_id, url, label, uptime_state, uptime_state_changed_at,
> uptime_enabled, uptime_24h_pct, uptime_30d_pct, avg_latency_ms_24h,
> p95_latency_ms_24h, sparkline[] }` (schema `uptimeSummarySchema` in
> `packages/shared`); detail via `GET /api/uptime/sites/[id]?days=30|90` →
> `uptimeDetailSchema` (series + recent_events + last_incident).

## Rules

- One tool = one REST endpoint; no business logic in the MCP layer.
- Tool definitions (name, title, description, input/output schemas) live in
  `packages/shared/src/mcp-tools.ts` — the MCP server maps them to REST
  calls (`src/server.ts`), it does not redefine the contract.
- `list_checks` is the only exception to the 1-op-1-REST rule: the check
  catalog has no REST route, so the tool reads it from `@scanpal/shared`
  (single source of truth, pure data).
- Auth is **per-team**: an API key identifies a team; the REST API enforces
  scoping (MCP passes the key through, never overrides it).
- Key is sent via `Authorization: Bearer <key>` (statische `sp_live_`-key,
  feature 25/plan 14); HMAC signing is een latere uitbreiding — keep the
  client abstracted (`src/client.ts`) so the auth mode is swappable.
- Errors: map HTTP status → tool error (404 → "site/scan not found",
  401/403 → auth failure, 202 → "scan started, use get_scan to poll").
- Progress (plan 63, besluit 4): no streaming protocol — the client polls
  `get_scan` during `queued`/`running` (documented in the README).
- Pagination: `list_findings` caps `limit` at 50 per call (plan-63-besluit 5,
  REST contract supports 200).

## Commands

```bash
pnpm --filter mcp-server dev       # stdio or HTTP transport
pnpm --filter mcp-server typecheck
pnpm --filter mcp-server test
```
