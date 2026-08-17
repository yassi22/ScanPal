import {
  findingSchema,
  findingsPayloadSchema,
  severityRank,
  type Finding,
} from "@scanpal/shared";

/**
 * Rij in de `checks`-tabel (plan 27, besluit 5): één rij per check-run,
 * idempotent ge-upsert. De workers schrijven de volledige finding-payload in
 * `finding`; de aggregator bouwt daaruit de finale `scans.findings` — er
 * wordt nooit per check in het jsonb-items-array gemerged (concurrente
 * writes zouden verloren gaan).
 *
 * Plan 54: `finding` mag óf één finding-object óf een array van findings zijn
 * (per-route checks produceren meerdere findings per check — één per route).
 * Beide vormen worden hier geflattend tot het versioned payload.
 */
export type CheckRow = {
  check_id: string;
  category: string;
  status: string;
  severity: string | null;
  finding: Record<string, unknown> | null;
};

/**
 * Checks-rijen → versioned findings-payload (v1), gesorteerd van kritiek
 * naar info. Validatie met `findingsPayloadSchema` (plan 09-contract).
 */
export function buildFindingsFromChecks(rows: CheckRow[]): Record<string, unknown> {
  const items: Finding[] = [];
  for (const row of rows) {
    if (!row.finding) continue;
    const candidates = Array.isArray(row.finding) ? row.finding : [row.finding];
    for (const candidate of candidates) {
      const parsed = findingSchema.safeParse(candidate);
      if (parsed.success) items.push(parsed.data);
    }
  }
  items.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  return findingsPayloadSchema.parse({ v: 1, items });
}