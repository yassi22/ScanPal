import type { Pool } from "pg";
import type { Finding } from "@scanpal/shared";

/**
 * Plan 62 — CrUX field data. `scans.crux` is een scans-kolom (geen eigen
 * tabel, besluit 2); de http-worker-check schrijft het genormaliseerde
 * resultaat via deze helper (geen ad-hoc SQL in de worker). De aggregator
 * leest hetzelfde veld voor de lab/field-divergentie.
 */
export async function writeScanCrux(
  db: Pool,
  scanId: string,
  crux: Record<string, unknown> | null,
): Promise<void> {
  await db.query(
    "update scans set crux = $2 where id = $1",
    [scanId, JSON.stringify(crux ?? null)],
  );
}

/**
 * Derived finding (plan 62, crux-divergence): de aggregator berekent na alle
 * children de lab/field-divergentie en schrijft de finding als een extra
 * `checks`-rij (zelfde idempotente upsert-contract als de workers) zodat hij
 * in de finale findings-payload terechtkomt. Geen catalog-entry: de
 * progress-skeleton telt alleen `crux-field-data`.
 */
export async function upsertDerivedFinding(
  db: Pool,
  input: { scanId: string; finding: Finding },
): Promise<void> {
  const severity = input.finding.severity;
  const status =
    severity === "high" || severity === "critical"
      ? "fail"
      : severity === "info"
        ? "pass"
        : "warn";
  await db.query(
    `insert into checks (scan_id, check_id, category, status, severity, finding, route_url, completed_at)
     values ($1, $2, $3, $4, $5, $6, null, now())
     on conflict (scan_id, check_id) where route_url is null
     do update set
       status = excluded.status,
       severity = excluded.severity,
       finding = excluded.finding,
       completed_at = now()`,
    [
      input.scanId,
      input.finding.check_id,
      input.finding.category,
      status,
      severity,
      JSON.stringify(input.finding),
    ],
  );
}
