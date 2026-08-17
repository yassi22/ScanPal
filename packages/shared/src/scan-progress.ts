import { z } from "zod";

export const scanCategorySchema = z.enum(["http", "seo", "aeo", "github"]);
export type ScanCategory = z.infer<typeof scanCategorySchema>;

export const categoryStatusSchema = z.enum(["pending", "running", "done"]);
export type CategoryStatus = z.infer<typeof categoryStatusSchema>;

export const categoryProgressSchema = z.object({
  status: categoryStatusSchema,
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  percent: z.number().int().min(0).max(100),
  current_check: z.string().nullable(),
});
export type CategoryProgress = z.infer<typeof categoryProgressSchema>;

export const progressDetailsSchema = z.object({
  categories: z.record(scanCategorySchema, categoryProgressSchema),
  checks_done: z.number().int().min(0),
  checks_total: z.number().int().min(0),
  updated_at: z.string().datetime(),
});
export type ProgressDetails = z.infer<typeof progressDetailsSchema>;

export const severityCountsSchema = z.object({
  critical: z.number().int().min(0),
  high: z.number().int().min(0),
  medium: z.number().int().min(0),
  low: z.number().int().min(0),
  info: z.number().int().min(0),
});
export type SeverityCounts = z.infer<typeof severityCountsSchema>;

export const scanProgressEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("progress"),
    scan_id: z.string().uuid(),
    status: z.enum(["queued", "running"]),
    progress: z.object({
      overall: z.number().int().min(0).max(100),
      checks_done: z.number().int().min(0),
      checks_total: z.number().int().min(0),
      categories: z.record(scanCategorySchema, categoryProgressSchema),
    }),
  }),
  z.object({
    event: z.literal("completed"),
    scan_id: z.string().uuid(),
    status: z.literal("completed"),
    score: z.number().int().min(0).max(100).nullable(),
    summary: severityCountsSchema,
  }),
  z.object({
    event: z.literal("failed"),
    scan_id: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string(),
  }),
  z.object({
    event: z.literal("canceled"),
    scan_id: z.string().uuid(),
    status: z.literal("canceled"),
  }),
]);
export type ScanProgressEvent = z.infer<typeof scanProgressEventSchema>;
