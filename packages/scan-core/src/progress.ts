import type { Pool } from "pg";
import {
  advanceProgressDetails,
  initialProgressDetails,
  overallProgress,
  progressDetailsSchema,
  type ProgressDetails,
  type ScanCategory,
} from "@scanpal/shared";

/**
 * Progress-schrijvers (plan 27, besluit 4). Eén bron van waarheid voor de
 * `scans.progress` + `scans.progress_details`-update:
 * - `updateScanProgress` — simpel, zonder lock (single-threaded inline probe).
 * - `advanceCategoryProgress` — atomair met `select … for update` op de
 *   scans-rij (BullMQ-workers; checks draaien parallel, geen verloren updates).
 */

export async function updateScanProgress(
  db: Pool,
  scanId: string,
  patch: { progress: number; progressDetails: ProgressDetails },
): Promise<void> {
  await db.query(
    `update scans set progress = $2, progress_details = $3 where id = $1`,
    [scanId, patch.progress, JSON.stringify(patch.progressDetails)],
  );
}

export async function advanceCategoryProgress(
  db: Pool,
  scanId: string,
  category: ScanCategory,
  checkId: string,
  now: string,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const current = await client.query<{ progress_details: unknown }>(
      `select progress_details from scans where id = $1 for update`,
      [scanId],
    );
    if (current.rowCount === 0) {
      await client.query("rollback");
      return;
    }

    const parsed = progressDetailsSchema.safeParse(
      current.rows[0].progress_details,
    );
    if (!parsed.success) {
      await client.query("rollback");
      return;
    }

    const next = advanceProgressDetails(parsed.data, checkId, now);
    if (next === parsed.data) {
      await client.query("commit");
      return;
    }

    await client.query(
      `update scans
         set progress = $2, progress_details = $3
       where id = $1`,
      [scanId, overallProgress(next), JSON.stringify(next)],
    );

    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie is mogelijk al beëindigd — negeren
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Skelet schrijven (status running, progress 0) met de totale-standen. */
export async function writeProgressSkeleton(
  db: Pool,
  scanId: string,
  totals: Partial<Record<ScanCategory, number>>,
  now: string,
): Promise<void> {
  const details = initialProgressDetails(totals, now);
  await db.query(
    `update scans
       set status = 'running', progress = 0, progress_details = $2
     where id = $1`,
    [scanId, JSON.stringify(details)],
  );
}