import type { PoolClient } from "pg";
import {
  computeScanDiff,
  findingsPayloadSchema,
  isCleanScan,
  type FindingsPayload,
  type ScanDiff,
} from "@scanpal/shared";

/**
 * Diff-berekening (plan 59, stap 2): de laatste schone snapshot van de site
 * zoeken en de diff + regressed-flags berekenen. Draait binnen de transactie
 * van `finishScan` — de snapshot en de huidige scan staan dan in dezelfde
 * consistency-venster.
 */

/** Laatste schone voltooide scan van de site (excl. deze scan). */
export async function findCleanSnapshot(
  client: PoolClient,
  siteId: string,
  scanId: string,
): Promise<FindingsPayload | null> {
  const result = await client.query<{ score: number | null; findings: unknown }>(
    `select score, findings from scans
      where site_id = $1 and id != $2 and status = 'completed'
      order by created_at desc
      limit 20`,
    [siteId, scanId],
  );
  for (const row of result.rows) {
    const parsed = findingsPayloadSchema.safeParse(row.findings);
    if (!parsed.success) continue;
    if (isCleanScan(row.score, parsed.data.items)) {
      return parsed.data;
    }
  }
  return null;
}

/**
 * Berekent de diff van de nieuwe findings t.o.v. de snapshot, markeert de
 * regressed-findings (`regressed: true`) en consumeert het `"next-scan"`-
 * sentinel (dat dempte deze scan — het mag de volgende niet nóg dempen).
 * Niet-v1-payloads (bijv. een `{ error }`-finding van een mislukte scan)
 * passeren onveranderd.
 */
export async function computeAndWriteScanDiff(
  client: PoolClient,
  siteId: string,
  scanId: string,
  findings: Record<string, unknown>,
): Promise<{ findings: Record<string, unknown>; diff: ScanDiff | null }> {
  const parsed = findingsPayloadSchema.safeParse(findings);
  if (!parsed.success) return { findings, diff: null };

  const snapshot = await findCleanSnapshot(client, siteId, scanId);
  const diff = computeScanDiff(parsed.data.items, snapshot?.items ?? null);

  const regressed = new Set(diff.regressed_finding_ids);
  const needsRewrite = parsed.data.items.some(
    (finding) =>
      finding.snooze_until === "next-scan" || regressed.has(finding.id),
  );
  if (!needsRewrite) return { findings, diff };

  const items = parsed.data.items.map((finding) => ({
    ...finding,
    regressed: regressed.has(finding.id) ? true : finding.regressed,
    snooze_until: finding.snooze_until === "next-scan" ? null : finding.snooze_until,
  }));
  return {
    findings: findingsPayloadSchema.parse({ v: 1, items }),
    diff,
  };
}