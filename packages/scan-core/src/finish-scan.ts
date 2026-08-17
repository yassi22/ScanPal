import type { Pool, PoolClient } from "pg";
import { carryOverFindingStatuses } from "./finding-status";
import { ScanError, type FinishScanInput, type ScanRowWithMeta } from "./types";

/**
 * Denormaliseerde status-cache bijwerken na een scan (plan 04). Idempotent;
 * gebruikt door de webapp-flow en de worker-aggregator (plan 27). Verwacht een
 * open transactie (client).
 */
export async function setSiteScanState(
  client: PoolClient,
  siteId: string,
  patch: { scanId: string; status: string; score?: number | null },
): Promise<void> {
  await client.query(
    `update sites
       set last_scan_id = $1,
           last_scan_status = $2,
           last_scan_score = coalesce($3, last_scan_score),
           last_scanned_at = now()
     where id = $4`,
    [patch.scanId, patch.status, patch.score ?? null, siteId],
  );
}

/**
 * Markeert een scan als completed/failed en werkt de denormaliseerde
 * site-status bij. Past finding-status-carry-over toe (plan 09) en schrijft
 * de per-categorie-scores (plan 08/27). De BullMQ-aggregator gebruikt deze
 * helper — de webapp re-exporteert.
 *
 * Race-guard (plan 19): is de scan inmiddels gecanceld, dan wordt de status
 * nooit overschreven — de scan blijft `canceled` en de site-status blijft
 * onaangeroerd (de refund is al gebeurd bij de cancel).
 */
export async function finishScan(
  db: Pool,
  input: FinishScanInput,
): Promise<ScanRowWithMeta> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const current = await client.query(
      "select status from scans where id = $1 for update",
      [input.scanId],
    );
    if (current.rowCount === 0) {
      await client.query("rollback");
      throw new ScanError("not_found", "Scan niet gevonden");
    }
    if (current.rows[0].status === "canceled") {
      const row = await client.query("select * from scans where id = $1", [
        input.scanId,
      ]);
      await client.query("commit");
      return row.rows[0] as ScanRowWithMeta;
    }

    const findings = await carryOverFindingStatuses(client, {
      scanId: input.scanId,
      siteId: input.siteId,
      findings: input.findings ?? {},
    });

    const updated = await client.query(
      `update scans
        set status = $2, progress = 100, score = $3, findings = $4,
            category_scores = $5, completed_at = now()
       where id = $1
       returning *`,
      [
        input.scanId,
        input.status,
        input.score ?? null,
        JSON.stringify(findings),
        input.categoryScores ? JSON.stringify(input.categoryScores) : null,
      ],
    );

    await setSiteScanState(client, input.siteId, {
      scanId: input.scanId,
      status: input.status,
      score: input.score ?? null,
    });

    await client.query("commit");
    return updated.rows[0] as ScanRowWithMeta;
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