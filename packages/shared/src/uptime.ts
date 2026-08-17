import { z } from "zod";
import { siteStatusSchema } from "./sites";

export const uptimeStatusSchema = z.enum(["up", "down"]);
export type UptimeStatus = z.infer<typeof uptimeStatusSchema>;

export const uptimeEventSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  checked_at: z.string().datetime(),
  status: uptimeStatusSchema,
  latency_ms: z.number().int().nullable(),
  status_code: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type UptimeEvent = z.infer<typeof uptimeEventSchema>;

/**
 * Aggregaat per site voor de uptime-dashboard-lijst. `uptime_*_pct` is
 * het percentage geslaagde checks in het venster (null zolang er geen
 * checks zijn); `sparkline` zijn uurbuckets van de laatste 24 uur.
 */
export const uptimeSummarySchema = z.object({
  site_id: z.string().uuid(),
  url: z.string(),
  label: z.string().nullable(),
  uptime_state: siteStatusSchema,
  uptime_state_changed_at: z.string().datetime().nullable(),
  uptime_enabled: z.boolean(),
  uptime_24h_pct: z.number().min(0).max(100).nullable(),
  uptime_30d_pct: z.number().min(0).max(100).nullable(),
  avg_latency_ms_24h: z.number().nullable(),
  p95_latency_ms_24h: z.number().nullable(),
  sparkline: z.array(
    z.object({
      at: z.string().datetime(),
      up_pct: z.number().min(0).max(100),
      avg_latency_ms: z.number().nullable(),
    }),
  ),
});
export type UptimeSummary = z.infer<typeof uptimeSummarySchema>;

export const uptimeListResponseSchema = z.object({
  sites: z.array(uptimeSummarySchema),
});
export type UptimeListResponse = z.infer<typeof uptimeListResponseSchema>;

export const uptimeSeriesPointSchema = z.object({
  at: z.string().datetime(),
  up_pct: z.number().min(0).max(100),
  avg_latency_ms: z.number().nullable(),
});
export type UptimeSeriesPoint = z.infer<typeof uptimeSeriesPointSchema>;

export const uptimeIncidentSchema = z.object({
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
});
export type UptimeIncident = z.infer<typeof uptimeIncidentSchema>;

export const uptimeDetailSchema = z.object({
  summary: uptimeSummarySchema,
  series: z.array(uptimeSeriesPointSchema),
  recent_events: z.array(uptimeEventSchema).max(20),
  last_incident: uptimeIncidentSchema.nullable(),
});
export type UptimeDetail = z.infer<typeof uptimeDetailSchema>;

export const uptimeHistoryQuerySchema = z.object({
  days: z.coerce.number().int().refine((v) => v === 30 || v === 90, {
    message: "days moet 30 of 90 zijn",
  }),
});
export type UptimeHistoryQuery = z.infer<typeof uptimeHistoryQuerySchema>;

export const updateUptimeMonitoringSchema = z.object({
  enabled: z.boolean(),
});
export type UpdateUptimeMonitoring = z.infer<
  typeof updateUptimeMonitoringSchema
>;
