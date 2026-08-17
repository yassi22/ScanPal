import type { ProgressDetails, ScanTrigger } from "@scanpal/shared";

/**
 * Gedeelde scan-typen voor web + worker (plan 27, besluit 3). De webapp
 * re-exporteert deze zodat bestaande routes ongewijzigd blijven.
 */
export type ScanRowWithMeta = {
  id: string;
  site_id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  progress_details: ProgressDetails;
  score: number | null;
  findings: Record<string, unknown>;
  category_scores: Record<string, unknown> | null;
  /** Plan 59: diff t.o.v. de laatste schone snapshot (scanDiffSchema). */
  diff: Record<string, unknown>;
  active_tests: boolean;
  trigger: ScanTrigger;
  scheduled_for: Date | null;
  created_at: Date;
  completed_at: Date | null;
};

export type ScanErrorCode = "not_found" | "overlap";

export class ScanError extends Error {
  constructor(
    public code: ScanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScanError";
  }
}

export type FinishScanInput = {
  scanId: string;
  siteId: string;
  status: "completed" | "failed";
  score?: number | null;
  findings?: Record<string, unknown>;
  categoryScores?: Record<string, unknown> | null;
};