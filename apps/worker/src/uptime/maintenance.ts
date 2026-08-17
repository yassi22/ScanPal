import type { Pool } from "pg";
import { acquireLock, releaseLock, type LockClient } from "./lock";

export type MaintenanceDeps = {
  db: Pool;
  redis: LockClient;
  now?: Date;
  log?: (line: string) => void;
};

export type MaintenanceResult = {
  rolledUpDays: number;
  deletedEvents: number;
  skipped: boolean;
};

const MAINTENANCE_LOCK_KEY = "uptime:maintenance";
const MAINTENANCE_LOCK_TTL_SECONDS = 3600;

/**
 * Idempotente maintenance (elke 6u): eerst complete dagen rollupen naar
 * `uptime_daily` (INSERT … ON CONFLICT DO UPDATE), daarna events ouder dan
 * 30 dagen verwijderen. Een Redis-lock voorkomt overlap tussen instances.
 */
export async function runUptimeMaintenance(
  deps: MaintenanceDeps,
): Promise<MaintenanceResult> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? (() => {});

  const token = await acquireLock(
    deps.redis,
    MAINTENANCE_LOCK_KEY,
    MAINTENANCE_LOCK_TTL_SECONDS,
  );
  if (!token) {
    log("uptime-maintenance: lock bezet, overgeslagen");
    return { rolledUpDays: 0, deletedEvents: 0, skipped: true };
  }

  try {
    const rollup = await deps.db.query(
      `with agg as (
         select site_id,
                checked_at::date as day,
                count(*) as checks,
                count(*) filter (where status = 'down') as failures,
                avg(latency_ms) as avg_latency_ms,
                percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
         from uptime_events
         where checked_at < date_trunc('day', $1::timestamptz)
         group by site_id, checked_at::date
       )
       insert into uptime_daily (site_id, day, checks, failures, avg_latency_ms, p95_latency_ms)
       select site_id, day, checks, failures, avg_latency_ms, p95_latency_ms
       from agg
       on conflict (site_id, day) do update set
         checks = excluded.checks,
         failures = excluded.failures,
         avg_latency_ms = excluded.avg_latency_ms,
         p95_latency_ms = excluded.p95_latency_ms`,
      [now],
    );

    const cleanup = await deps.db.query(
      `delete from uptime_events
       where checked_at < $1::timestamptz - interval '30 days'`,
      [now],
    );

    const result: MaintenanceResult = {
      rolledUpDays: rollup.rowCount ?? 0,
      deletedEvents: cleanup.rowCount ?? 0,
      skipped: false,
    };

    if (result.rolledUpDays === 0 && result.deletedEvents > 0) {
      log("uptime-maintenance: rollup compleet, events opgeruimd");
    }
    return result;
  } finally {
    await releaseLock(deps.redis, MAINTENANCE_LOCK_KEY, token);
  }
}
