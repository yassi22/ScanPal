import type { Pool } from "pg";
import type { RouteSource, ScanRoute } from "@scanpal/shared";

/**
 * DB-helpers voor route-discovery (plan 54). Gedeeld door de crawler-processor
 * (`apps/worker/src/queues/crawl.ts`) en de API/UI via re-export. Alle writes
 * zijn idempotent (upsert op `(scan_id, url)`).
 */

export type ScanRouteRow = {
  url: string;
  source: RouteSource;
  http_status: number | null;
};

/**
 * Schrijft ontdekte routes weg (besluit 2). Bestaande rijen voor deze scan
 * worden eerst gewist zodat een re-run geen stale routes achterlaat; daarna
 * batch-insert met `on conflict do nothing`. `route_count` wordt denormaliseerd
 * op `scans` gezet. Retourneert de opgeslagen routes in volgorde.
 */
export async function upsertScanRoutes(
  db: Pool,
  scanId: string,
  routes: ScanRouteRow[],
): Promise<ScanRoute[]> {
  if (routes.length === 0) {
    await db.query("delete from scan_routes where scan_id = $1", [scanId]);
    await db.query("update scans set route_count = 0 where id = $1", [scanId]);
    return [];
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("delete from scan_routes where scan_id = $1", [scanId]);

    const values: string[] = [];
    const params: unknown[] = [scanId];
    let paramIdx = 2;
    for (const route of routes) {
      params.push(route.url, route.source);
      values.push(`($1, $${paramIdx}, $${paramIdx + 1})`);
      paramIdx += 2;
    }
    await client.query(
      `insert into scan_routes (scan_id, url, source)
       values ${values.join(", ")}
       on conflict (scan_id, url) do nothing`,
      params,
    );
    await client.query("update scans set route_count = $2 where id = $1", [
      scanId,
      routes.length,
    ]);
    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie mogelijk al beëindigd
    }
    throw err;
  } finally {
    client.release();
  }

  return routes.map((r) => ({
    url: r.url,
    source: r.source,
    http_status: r.http_status,
  }));
}

/** Leest de routes van een scan (volgorde: created_at). */
export async function getScanRoutes(
  db: Pool,
  scanId: string,
): Promise<ScanRoute[]> {
  const result = await db.query<{
    url: string;
    source: RouteSource;
    http_status: number | null;
  }>(
    `select url, source, http_status from scan_routes
     where scan_id = $1 order by created_at asc`,
    [scanId],
  );
  return result.rows.map((row) => ({
    url: row.url,
    source: row.source,
    http_status: row.http_status,
  }));
}

/**
 * Werkt de HTTP-status van één route bij tijdens de check-fase (besluit 2).
 * No-op als de route niet bij deze scan hoort.
 */
export async function setRouteHttpStatus(
  db: Pool,
  scanId: string,
  url: string,
  httpStatus: number,
): Promise<void> {
  await db.query(
    `update scan_routes set http_status = $3
     where scan_id = $1 and url = $2`,
    [scanId, url, httpStatus],
  );
}

/**
 * Werkt meerdere route-statussen gebundeld bij in één UPDATE (scan-tijd): de
 * scan-worker verzamelt de statussen per route en schrijft ze in één keer weg
 * i.p.v. één round-trip per route. No-op bij een lege lijst.
 */
export async function setRouteHttpStatuses(
  db: Pool,
  scanId: string,
  entries: { url: string; status: number }[],
): Promise<void> {
  if (entries.length === 0) return;
  const tuples: string[] = [];
  const params: unknown[] = [scanId];
  let i = 2;
  for (const entry of entries) {
    tuples.push(`($${i}, $${i + 1}::int)`);
    params.push(entry.url, entry.status);
    i += 2;
  }
  await db.query(
    `update scan_routes set http_status = v.status
     from (values ${tuples.join(", ")}) as v(url, status)
     where scan_routes.scan_id = $1 and scan_routes.url = v.url`,
    params,
  );
}
