import "server-only";

import type { Pool } from "pg";
import type { UptimeDetail, UptimeSummary } from "@scanpal/shared";

type SiteAggRow = {
  site_id: string;
  url: string;
  label: string | null;
  uptime_state: "up" | "down" | "unknown";
  uptime_state_changed_at: Date | null;
  last_checked_at: Date | null;
  probe_fresh: boolean;
  uptime_enabled: boolean;
  up24: number;
  total24: number;
  avg_latency_24: number | null;
  p95_latency_24: number | null;
  up30: number;
  total30: number;
};

type SparklineRow = {
  site_id: string;
  bucket: Date;
  ups: number;
  total: number;
  avg_latency: number | null;
};

type SeriesRow = {
  bucket: Date;
  ups: number;
  total: number;
  avg_latency: number | null;
};

type EventRow = {
  id: string;
  site_id: string;
  checked_at: Date;
  status: "up" | "down";
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
};

function pct(up: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((up / total) * 10000) / 100;
}

function roundMs(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 10) / 10;
}

const AGGREGATE_SUBQUERIES = `
  (select count(*) from uptime_events e
     where e.site_id = s.id and e.status = 'up' and e.checked_at > now() - interval '24 hours')::int as up24,
  (select count(*) from uptime_events e
     where e.site_id = s.id and e.checked_at > now() - interval '24 hours')::int as total24,
  (select avg(latency_ms) from uptime_events e
     where e.site_id = s.id and e.checked_at > now() - interval '24 hours'
       and e.latency_ms is not null) as avg_latency_24,
  (select percentile_cont(0.95) within group (order by latency_ms) from uptime_events e
     where e.site_id = s.id and e.checked_at > now() - interval '24 hours'
       and e.latency_ms is not null) as p95_latency_24,
  (select count(*) from uptime_events e
     where e.site_id = s.id and e.status = 'up' and e.checked_at > now() - interval '30 days')::int as up30,
  (select count(*) from uptime_events e
     where e.site_id = s.id and e.checked_at > now() - interval '30 days')::int as total30`;

function toSummary(
  row: SiteAggRow,
  sparkline: { bucket: Date; ups: number; total: number; avg_latency: number | null }[],
): UptimeSummary {
  return {
    site_id: row.site_id,
    url: row.url,
    label: row.label,
    uptime_state: row.uptime_state,
    uptime_state_changed_at: row.uptime_state_changed_at
      ? row.uptime_state_changed_at.toISOString()
      : null,
    last_checked_at: row.last_checked_at?.toISOString() ?? null,
    probe_fresh: row.probe_fresh,
    uptime_enabled: row.uptime_enabled,
    uptime_24h_pct: pct(row.up24, row.total24),
    uptime_30d_pct: pct(row.up30, row.total30),
    avg_latency_ms_24h: roundMs(row.avg_latency_24),
    p95_latency_ms_24h: roundMs(row.p95_latency_24),
    sparkline: sparkline
      .sort((a, b) => a.bucket.getTime() - b.bucket.getTime())
      .map((point) => ({
        at: point.bucket.toISOString(),
        up_pct: pct(point.ups, point.total) ?? 0,
        avg_latency_ms: roundMs(point.avg_latency),
      })),
  };
}

export async function listUptimeSummaries(
  db: Pool,
  teamId: string,
): Promise<UptimeSummary[]> {
  const [aggregates, sparkline] = await Promise.all([
    db.query<SiteAggRow>(
      `select s.id as site_id, s.url, s.label, s.uptime_state,
              s.uptime_state_changed_at, s.uptime_enabled,
              (select max(e.checked_at) from uptime_events e where e.site_id = s.id) as last_checked_at,
              coalesce((select max(e.checked_at) > now() - interval '3 minutes' from uptime_events e where e.site_id = s.id), false) as probe_fresh,
              ${AGGREGATE_SUBQUERIES}
       from sites s
       where s.team_id = $1
       order by s.created_at desc`,
      [teamId],
    ),
    db.query<SparklineRow>(
      `select e.site_id,
              date_trunc('hour', e.checked_at) as bucket,
              count(*) filter (where e.status = 'up') as ups,
              count(*) as total,
              avg(e.latency_ms) as avg_latency
       from uptime_events e
       join sites s on s.id = e.site_id
       where s.team_id = $1 and e.checked_at > now() - interval '24 hours'
       group by e.site_id, date_trunc('hour', e.checked_at)`,
      [teamId],
    ),
  ]);

  const bySite = new Map<string, typeof sparkline.rows>();
  for (const row of sparkline.rows) {
    const list = bySite.get(row.site_id) ?? [];
    list.push(row);
    bySite.set(row.site_id, list);
  }

  return aggregates.rows.map((row) =>
    toSummary(row, bySite.get(row.site_id) ?? []),
  );
}

type SiteWithAgg = SiteAggRow & { team_id: string };

/**
 * Detail voor één site; null als de site niet van het team is (authz-rule:
 * vreemde site_id → 404, geen lek).
 */
export async function getUptimeDetail(
  db: Pool,
  teamId: string,
  siteId: string,
  days: 30 | 90,
): Promise<UptimeDetail | null> {
  const site = await db.query<SiteWithAgg>(
    `select s.id as site_id, s.url, s.label, s.uptime_state,
            s.uptime_state_changed_at, s.uptime_enabled,
            (select max(e.checked_at) from uptime_events e where e.site_id = s.id) as last_checked_at,
            coalesce((select max(e.checked_at) > now() - interval '3 minutes' from uptime_events e where e.site_id = s.id), false) as probe_fresh,
            ${AGGREGATE_SUBQUERIES}
     from sites s
     where s.team_id = $1 and s.id = $2`,
    [teamId, siteId],
  );
  if (site.rowCount === 0) return null;

  const [series, recent, incident] = await Promise.all([
    db.query<SeriesRow>(
      days === 30
        ? `select date_trunc('hour', e.checked_at) as bucket,
                  count(*) filter (where e.status = 'up') as ups,
                  count(*) as total,
                  avg(e.latency_ms) as avg_latency
           from uptime_events e
           where e.site_id = $1 and e.checked_at > now() - interval '30 days'
           group by date_trunc('hour', e.checked_at)
           order by 1`
        : `select d.day as bucket,
                  d.checks - d.failures as ups,
                  d.checks as total,
                  d.avg_latency_ms as avg_latency
           from uptime_daily d
           where d.site_id = $1 and d.day >= (now() - interval '90 days')::date
           order by d.day`,
      [siteId],
    ),
    db.query<EventRow>(
      `select id, site_id, checked_at, status, latency_ms, status_code, error
       from uptime_events
       where site_id = $1
       order by checked_at desc
       limit 20`,
      [siteId],
    ),
    db.query<{ started_at: Date; ended_at: Date | null }>(
      `select e.checked_at as started_at, n.checked_at as ended_at
       from uptime_events e
       left join lateral (
         select checked_at from uptime_events
         where site_id = e.site_id and status = 'up' and checked_at > e.checked_at
         order by checked_at
         limit 1
       ) n on true
       where e.site_id = $1 and e.status = 'down'
       order by e.checked_at desc
       limit 1`,
      [siteId],
    ),
  ]);

  const row = site.rows[0];
  return {
    summary: toSummary(row, []),
    series: series.rows.map((s) => ({
      at: s.bucket.toISOString(),
      up_pct: pct(s.ups, s.total) ?? 0,
      avg_latency_ms: roundMs(s.avg_latency),
    })),
    recent_events: recent.rows.map((e) => ({
      id: e.id,
      site_id: e.site_id,
      checked_at: e.checked_at.toISOString(),
      status: e.status,
      latency_ms: e.latency_ms,
      status_code: e.status_code,
      error: e.error,
    })),
    last_incident: incident.rowCount
      ? {
          started_at: incident.rows[0].started_at.toISOString(),
          ended_at: incident.rows[0].ended_at
            ? incident.rows[0].ended_at.toISOString()
            : null,
        }
      : null,
  };
}

/** Zet de monitoring-toggle; false als de site niet van het team is. */
export async function setUptimeMonitoring(
  db: Pool,
  teamId: string,
  siteId: string,
  enabled: boolean,
): Promise<boolean> {
  const result = await db.query(
    "update sites set uptime_enabled = $3 where id = $1 and team_id = $2",
    [siteId, teamId, enabled],
  );
  return (result.rowCount ?? 0) > 0;
}
