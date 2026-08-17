import type { PoolClient } from "pg";
import {
  applyFindingStatusCarryOver,
  findingsPayloadSchema,
} from "@scanpal/shared";

/**
 * Carry-over van finding-status over scans (plan 09, besluit 8): haalt de
 * laatste voltooide scan van dezelfde site op en kopieert per stabiele
 * finding-id `status` + `note` (`fixed`/`ignored` blijven staan, `open`
 * wordt overschreven). Draait idempotent — altijd na het schrijven van
 * findings, ongeacht poging. Niet-payload-findings (bijv. `{ error }`) bij
 * een mislukte scan passeren onveranderd.
 */
export async function carryOverFindingStatuses(
  client: PoolClient,
  input: { scanId: string; siteId: string; findings: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const current = findingsPayloadSchema.safeParse(input.findings);
  if (!current.success) return input.findings;

  const previous = await client.query(
    `select findings from scans
     where site_id = $1 and id != $2 and status = 'completed'
     order by created_at desc
     limit 1`,
    [input.siteId, input.scanId],
  );
  if (previous.rowCount === 0) return input.findings;

  const previousPayload = findingsPayloadSchema.safeParse(
    previous.rows[0].findings,
  );
  if (!previousPayload.success) return input.findings;

  return applyFindingStatusCarryOver(current.data, previousPayload.data);
}