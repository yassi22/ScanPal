import { z } from "zod";
import { scanStatusSchema } from "./sites";
import { progressDetailsSchema } from "./scan-progress";
import { categoryScoresSchema } from "./scoring";

export const scanFrequencySchema = z.enum(["none", "daily", "weekly"]);
export type ScanFrequency = z.infer<typeof scanFrequencySchema>;

export const scanTriggerSchema = z.enum(["manual", "schedule"]);
export type ScanTrigger = z.infer<typeof scanTriggerSchema>;

export const scanSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  status: scanStatusSchema,
  progress: z.number().int().min(0).max(100),
  progress_details: progressDetailsSchema.optional(),
  score: z.number().int().min(0).max(100).nullable(),
  findings: z.record(z.string(), z.unknown()).default({}),
  active_tests: z.boolean().default(false),
  trigger: scanTriggerSchema,
  scheduled_for: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type Scan = z.infer<typeof scanSchema>;

export const scanTriggerInputSchema = z.object({
  site_id: z.string().uuid("Ongeldige site-id"),
  /** Plan 52: opt-in actieve vulnerability-tests (alleen Pro). */
  active_tests: z.boolean().optional().default(false),
});
export type ScanTriggerInput = z.infer<typeof scanTriggerInputSchema>;

export const siteScheduleSchema = z.object({
  frequency: scanFrequencySchema,
});
export type SiteSchedule = z.infer<typeof siteScheduleSchema>;

export const scanListItemSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  site_url: z.string(),
  site_label: z.string().nullable(),
  status: scanStatusSchema,
  progress: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100).nullable(),
  active_tests: z.boolean().default(false),
  trigger: scanTriggerSchema,
  scheduled_for: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type ScanListItem = z.infer<typeof scanListItemSchema>;

export const scanHistoryResponseSchema = z.object({
  scans: z.array(scanListItemSchema),
});
export type ScanHistoryResponse = z.infer<typeof scanHistoryResponseSchema>;

export const scanCreateResponseSchema = z.object({
  scan: scanSchema,
});
export type ScanCreateResponse = z.infer<typeof scanCreateResponseSchema>;

/**
 * Feature 10 — score-trend per site. Één punt per voltooide scan, in
 * chronologische volgorde (oud → nieuw). `score` is de overall-score;
 * `category_scores` dekt de per-categorie-scores die de aggregator
 * (plan 27) in `scans.category_scores` schrijft. `failed`-scans
 * worden meegenomen met `score: null` zodat een mislukte scan zichtbaar
 * blijft in de trendlijn.
 */
export const scanTrendPointSchema = z.object({
  id: z.string().uuid(),
  status: scanStatusSchema,
  score: z.number().int().min(0).max(100).nullable(),
  category_scores: categoryScoresSchema.nullable(),
  trigger: scanTriggerSchema,
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type ScanTrendPoint = z.infer<typeof scanTrendPointSchema>;

export const scanTrendResponseSchema = z.object({
  site: z.object({
    id: z.string().uuid(),
    url: z.string(),
    label: z.string().nullable(),
    last_scan_score: z.number().int().min(0).max(100).nullable(),
    last_scanned_at: z.string().datetime().nullable(),
  }),
  points: z.array(scanTrendPointSchema),
});
export type ScanTrendResponse = z.infer<typeof scanTrendResponseSchema>;
