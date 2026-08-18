import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpCheckCatalog, mcpToolDefinitions } from "@scanpal/shared";
import type { ApiClient } from "./client";

type ToolResult = {
  content: { type: "text"; text: string }[];
};

type ToolHandler = (
  client: ApiClient,
) => (args: Record<string, unknown>) => Promise<ToolResult>;

const toText = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

function toQueryParams(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

/**
 * REST-mapping per tool (1 tool = 1 REST-endpoint). De tool-definities
 * (naam, beschrijving, schema's) komen uit `packages/shared/mcp-tools.ts`;
 * hier woont alleen de client-call. `list_checks` is de uitzondering: de
 * check-catalog heeft geen REST-route en wordt rechtstreeks uit shared
 * gelezen (single source of truth, pure data).
 */
export const handlers: Record<string, ToolHandler> = {
  run_scan: (client) => async (args) =>
    toText(await client.runScan({ site_id: String(args.site_id) })),
  get_scan: (client) => async (args) =>
    toText(await client.getScan(String(args.id))),
  get_findings: (client) => async (args) => {
    const { id, ...query } = args;
    return toText(await client.getFindings(String(id), toQueryParams(query)));
  },
  list_findings: (client) => async (args) => {
    const { scan_id, ...query } = args;
    return toText(await client.listFindings(String(scan_id), toQueryParams(query)));
  },
  get_finding: (client) => async (args) =>
    toText(
      await client.getFinding(String(args.scan_id), String(args.finding_id)),
    ),
  dismiss_finding: (client) => async (args) => {
    const body: { status: string; note?: string } = {
      status: String(args.status),
    };
    if (args.note !== undefined) body.note = String(args.note);
    return toText(
      await client.dismissFinding(
        String(args.scan_id),
        String(args.finding_id),
        body,
      ),
    );
  },
  get_scan_diff: (client) => async (args) =>
    toText(await client.getScanDiff(String(args.scan_id))),
  list_scans: (client) => async (args) =>
    toText(await client.listScans(toQueryParams(args))),
  list_sites: (client) => async () => toText(await client.listSites()),
  get_site: (client) => async (args) =>
    toText(await client.getSite(String(args.site_id))),
  get_uptime: (client) => async () => toText(await client.getUptime()),
  get_uptime_history: (client) => async (args) =>
    toText(
      await client.getUptimeHistory(String(args.site_id), Number(args.days ?? 30)),
    ),
  generate_fix_prompt: (client) => async (args) =>
    toText(await client.getFixPrompt(String(args.id))),
  list_checks: () => async () => toText(mcpCheckCatalog),
};

export function createScanpalServer(client: ApiClient): McpServer {
  const server = new McpServer({ name: "scanpal", version: "0.2.0" });

  for (const tool of mcpToolDefinitions) {
    const handler = handlers[tool.name];
    if (!handler) {
      throw new Error(`geen REST-mapping voor MCP-tool '${tool.name}'`);
    }
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
      },
      handler(client) as never,
    );
  }

  return server;
}
