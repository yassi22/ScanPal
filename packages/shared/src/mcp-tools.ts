import { z } from "zod";
import { findingSeveritySchema } from "./severity";
import { scanCategorySchema } from "./scan-progress";
import { findingStatusSchema, findingSchema, findingsResponseSchema } from "./findings";
import { scanDiffResponseSchema } from "./diff";
import { scanCreateResponseSchema, scanHistoryResponseSchema } from "./scans";
import { siteListResponseSchema, siteWithStatusSchema } from "./sites";
import { uptimeDetailSchema, uptimeListResponseSchema } from "./uptime";
import { fixPromptSchema } from "./fix-prompt";
import { checkCatalog, checkCatalogEntrySchema } from "./check-catalog";

/**
 * MCP-tool-definities (plan 63). Eén bron voor de tool-oppervlakte: input- en
 * output-schema's hergebruiken de REST-zod-schema's (contract 1-op-1, geen
 * eigen modellen). De MCP-server (packages/mcp-server) map deze definities
 * op REST-calls; hier zit geen netwerk- of handler-logica.
 *
 * `list_checks` is de uitzondering op de 1-op-1-REST-regel: er is geen
 * REST-route voor de check-catalog — de tool leest de catalog rechtstreeks
 * uit deze package (single source of truth, pure data).
 */

/** Pagination (besluit 5, aangepast op het REST-contract): max 50 per call. */
export const mcpPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type McpPagination = z.infer<typeof mcpPaginationSchema>;

export const mcpListFindingsInputSchema = z.object({
  scan_id: z.string().uuid("Geldige scan-id (uuid)"),
  severity: findingSeveritySchema.optional(),
  category: scanCategorySchema.optional(),
  status: findingStatusSchema.optional(),
  /** Filter op de route waarop de finding is gevonden (plan 54). */
  route_url: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["severity", "created_at", "title"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type McpListFindingsInput = z.infer<typeof mcpListFindingsInputSchema>;

export const mcpGetFindingInputSchema = z.object({
  scan_id: z.string().uuid("Geldige scan-id (uuid)"),
  finding_id: z.string().min(1, "finding_id is verplicht"),
});
export type McpGetFindingInput = z.infer<typeof mcpGetFindingInputSchema>;

export const mcpDismissFindingInputSchema = z.object({
  scan_id: z.string().uuid("Geldige scan-id (uuid)"),
  finding_id: z.string().min(1, "finding_id is verplicht"),
  status: z.enum(["fixed", "ignored"]),
  note: z.string().trim().max(500, "Note is maximaal 500 tekens").optional(),
});
export type McpDismissFindingInput = z.infer<typeof mcpDismissFindingInputSchema>;

export const mcpGetScanDiffInputSchema = z.object({
  scan_id: z.string().uuid("Geldige scan-id (uuid)"),
});
export type McpGetScanDiffInput = z.infer<typeof mcpGetScanDiffInputSchema>;

export const mcpListScansInputSchema = z.object({
  site_id: z.string().uuid("Geldige site-id (uuid)").optional(),
});
export type McpListScansInput = z.infer<typeof mcpListScansInputSchema>;

export const mcpGetSiteInputSchema = z.object({
  site_id: z.string().uuid("Geldige site-id (uuid)"),
});
export type McpGetSiteInput = z.infer<typeof mcpGetSiteInputSchema>;

export const mcpGetUptimeHistoryInputSchema = z.object({
  site_id: z.string().uuid("Geldige site-id (uuid)"),
  days: z
    .coerce
    .number()
    .int()
    .refine((v) => v === 30 || v === 90, {
      message: "days moet 30 of 90 zijn",
    })
    .default(30),
});
export type McpGetUptimeHistoryInput = z.infer<typeof mcpGetUptimeHistoryInputSchema>;

export const mcpListChecksInputSchema = z.object({});
export type McpListChecksInput = z.infer<typeof mcpListChecksInputSchema>;

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  outputSchema: z.ZodTypeAny;
};

export const mcpToolDefinitions: McpToolDefinition[] = [
  {
    name: "run_scan",
    title: "Scan starten",
    description:
      "Start een scan voor een site van je team en retourneer de scan-id. " +
      "Gebruik get_scan om te pollen tot de scan 'completed' is.",
    inputSchema: z.object({ site_id: z.string().uuid("Geldige site-id (uuid)") }),
    outputSchema: scanCreateResponseSchema,
  },
  {
    name: "get_scan",
    title: "Scanstatus ophalen",
    description:
      "Status, progress, scores en findings van een scan. Poll tot " +
      "status = 'completed' (run_scan geeft een 202/200).",
    inputSchema: z.object({ id: z.string().uuid("Geldige scan-id (uuid)") }),
    outputSchema: z.record(z.string(), z.unknown()),
  },
  {
    name: "get_findings",
    title: "Findings ophalen",
    description:
      "Gefilterde findings van een scan. Filters: severity, category, " +
      "status (open/fixed/ignored), q, limit, offset.",
    inputSchema: z.object({
      id: z.string().uuid("Geldige scan-id (uuid)"),
      severity: findingSeveritySchema.optional(),
      category: scanCategorySchema.optional(),
      status: findingStatusSchema.optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
    outputSchema: findingsResponseSchema,
  },
  {
    name: "list_findings",
    title: "Findings van een scan (gefilterd)",
    description:
      "Gefilterde findings van een scan met alle REST-filters: severity, " +
      "category, status, route_url, q, sort, order + pagination (max 50 " +
      "per call, offset). Retourneert { findings, total, counts, categories, " +
      "routes }.",
    inputSchema: mcpListFindingsInputSchema,
    outputSchema: findingsResponseSchema,
  },
  {
    name: "get_finding",
    title: "Finding-detail ophalen",
    description:
      "Eén finding van een scan: beschrijving, evidence, remediatie, " +
      "status en note. Gebruik list_findings om id's te vinden.",
    inputSchema: mcpGetFindingInputSchema,
    outputSchema: findingSchema,
  },
  {
    name: "dismiss_finding",
    title: "Finding afhandelen (fixed/ignored)",
    description:
      "De enige schrijftool: markeer een finding als 'fixed' of 'ignored' " +
      "met een optionele notitie. Niet-destructief; findings kunnen nooit " +
      "verwijderd worden.",
    inputSchema: mcpDismissFindingInputSchema,
    outputSchema: findingSchema,
  },
  {
    name: "get_scan_diff",
    title: "Scan-diff ophalen",
    description:
      "Diff van een scan t.o.v. de laatste schone snapshot: nieuwe, " +
      "opgeloste en teruggekeerde findings per severity + de " +
      "diff-geselecteerde findings (plan 59).",
    inputSchema: mcpGetScanDiffInputSchema,
    outputSchema: scanDiffResponseSchema,
  },
  {
    name: "list_scans",
    title: "Scan-historie",
    description:
      "Scan-historie van je team, optioneel gefilterd op site_id. " +
      "Retourneert { scans: [...] } met status, score en trigger per scan.",
    inputSchema: mcpListScansInputSchema,
    outputSchema: scanHistoryResponseSchema,
  },
  {
    name: "list_sites",
    title: "Sites van je team",
    description: "Alle sites van je team met status, score en GitHub-repo.",
    inputSchema: z.object({}),
    outputSchema: siteListResponseSchema,
  },
  {
    name: "get_site",
    title: "Site-detail ophalen",
    description:
      "Eén site van je team met status, last-scan, uptime-state en " +
      "scan-frequency. Gebruik list_sites om id's te vinden.",
    inputSchema: mcpGetSiteInputSchema,
    outputSchema: z.object({ site: siteWithStatusSchema }),
  },
  {
    name: "get_uptime",
    title: "Uptime-status",
    description:
      "Huidige uptime-status per site met 24u/30d-percentages en latency.",
    inputSchema: z.object({}),
    outputSchema: uptimeListResponseSchema,
  },
  {
    name: "get_uptime_history",
    title: "Uptime-historie van een site",
    description:
      "Uptime-detail van één site: series (30 of 90 dagen), recente events " +
      "en de laatste incident. Gebruik list_sites om id's te vinden.",
    inputSchema: mcpGetUptimeHistoryInputSchema,
    outputSchema: uptimeDetailSchema,
  },
  {
    name: "generate_fix_prompt",
    title: "Fix-prompt genereren",
    description:
      "Genereer één copy-paste fix-prompt (Engels) voor alle open findings " +
      "van een scan, gegroepeerd per bestand/route — voor Cursor/Claude/" +
      "Windsurf. Retourneert { prompt, findings_covered, truncated }.",
    inputSchema: z.object({ id: z.string().uuid("Geldige scan-id (uuid)") }),
    outputSchema: fixPromptSchema,
  },
  {
    name: "list_checks",
    title: "Check-catalogus",
    description:
      "De catalogus van alle checks die een scan uitvoert (id, categorie, " +
      "naam, actief-test-status). Handig om check-id's te kennen bij het " +
      "filteren of interpreteren van findings.",
    inputSchema: mcpListChecksInputSchema,
    outputSchema: z.array(checkCatalogEntrySchema),
  },
];

export function mcpToolDefinitionByName(name: string): McpToolDefinition | undefined {
  return mcpToolDefinitions.find((def) => def.name === name);
}

export const mcpCheckCatalog = checkCatalog;
