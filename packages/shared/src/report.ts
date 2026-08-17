import { z } from "zod";
import { findingSchema } from "./findings";
import { severityCountsSchema } from "./scan-progress";
import { scanTriggerSchema } from "./scans";
import { categoryScoresSchema } from "./scoring";

export const reportFormatSchema = z.enum(["md", "pdf"]);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/**
 * Eén gedeelde rapport-data-vorm: zowel de Markdown- als de PDF-renderer
 * consumeren dit object (geen twee bronnen van waarheid). `findings` is
 * gesorteerd op ernst (critical → info) en beperkt tot top-100 per ernst;
 * de afgekapte aantallen per ernst levert de route apart mee ("… and N more").
 */
export const reportDataSchema = z.object({
  scan: z.object({
    id: z.string().uuid(),
    trigger: scanTriggerSchema,
    created_at: z.string().datetime(),
    completed_at: z.string().datetime(),
  }),
  site: z.object({ url: z.string(), label: z.string().nullable() }),
  score: z.number().int().min(0).max(100),
  category_scores: categoryScoresSchema,
  summary: severityCountsSchema,
  findings: z.array(findingSchema),
});
export type ReportData = z.infer<typeof reportDataSchema>;

export const reportMetaSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  scan_id: z.string().uuid(),
  format: reportFormatSchema,
  filename: z.string(),
  size_bytes: z.number().int().min(0),
  created_at: z.string().datetime(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

/** Cursor = base64url(JSON({t: created_at iso, i: id})) — de laatste rij van de vorige pagina. */
export function encodeReportCursor(createdAt: string, id: string): string {
  const json = JSON.stringify({ t: createdAt, i: id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeReportCursor(
  cursor: string,
): { created_at: string; id: string } | null {
  try {
    const { t, i } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof t !== "string" || typeof i !== "string") return null;
    return { created_at: t, id: i };
  } catch {
    return null;
  }
}

export const reportListQuerySchema = z.object({
  site_id: z.string().uuid().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

/** Pagina-antwoord: `next_cursor` is null op de laatste pagina. */
export const reportListResponseSchema = z.object({
  reports: z.array(reportMetaSchema),
  next_cursor: z.string().nullable(),
});
export type ReportListResponse = z.infer<typeof reportListResponseSchema>;