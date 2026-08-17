import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import type { ApiClient } from "./client";

type ToolResult = {
  content: { type: "text"; text: string }[];
};

type ToolSpec = {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (client: ApiClient) => (args: Record<string, unknown>) => Promise<ToolResult>;
};

const toText = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

export const toolDefs: ToolSpec[] = [
  {
    name: "run_scan",
    title: "Scan starten",
    description:
      "Start een scan voor een site van je team en retourneer de scan-id. " +
      "Gebruik get_scan om te pollen tot de scan 'completed' is.",
    inputSchema: { site_id: z.string().uuid("Geldige site-id (uuid)") },
    handler: (client) => async (args) =>
      toText(await client.runScan({ site_id: String(args.site_id) })),
  },
  {
    name: "get_scan",
    title: "Scanstatus ophalen",
    description:
      "Status, progress, scores en findings van een scan. Poll tot " +
      "status = 'completed' (run_scan geeft een 202/200).",
    inputSchema: { id: z.string().uuid("Geldige scan-id (uuid)") },
    handler: (client) => async (args) =>
      toText(await client.getScan(String(args.id))),
  },
  {
    name: "get_findings",
    title: "Findings ophalen",
    description:
      "Gefilterde findings van een scan. Filters: severity, category, " +
      "status (open/fixed/ignored), q, limit, offset.",
    inputSchema: {
      id: z.string().uuid("Geldige scan-id (uuid)"),
      severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
      category: z.enum(["http", "seo", "aeo", "github"]).optional(),
      status: z.enum(["open", "fixed", "ignored"]).optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    },
    handler: (client) => async (args) => {
      const { id, ...query } = args;
      const params = Object.fromEntries(
        Object.entries(query).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      return toText(await client.getFindings(String(id), params));
    },
  },
  {
    name: "list_sites",
    title: "Sites van je team",
    description: "Alle sites van je team met status, score en GitHub-repo.",
    inputSchema: {},
    handler: (client) => async () => toText(await client.listSites()),
  },
  {
    name: "get_uptime",
    title: "Uptime-status",
    description:
      "Huidige uptime-status per site met 24u/30d-percentages en latency.",
    inputSchema: {},
    handler: (client) => async () => toText(await client.getUptime()),
  },
  {
    name: "generate_fix_prompt",
    title: "Fix-prompt genereren",
    description:
      "Genereer één copy-paste fix-prompt (Engels) voor alle open findings " +
      "van een scan, gegroepeerd per bestand/route — voor Cursor/Claude/" +
      "Windsurf. Retourneert { prompt, findings_covered, truncated }.",
    inputSchema: { id: z.string().uuid("Geldige scan-id (uuid)") },
    handler: (client) => async (args) =>
      toText(await client.getFixPrompt(String(args.id))),
  },
];

export function createScanpalServer(client: ApiClient): McpServer {
  const server = new McpServer({ name: "scanpal", version: "0.1.0" });

  for (const tool of toolDefs) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      tool.handler(client) as never,
    );
  }

  return server;
}
