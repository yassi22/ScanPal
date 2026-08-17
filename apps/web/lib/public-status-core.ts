import "server-only";

import type { Pool } from "pg";
import {
  publicErrorClass,
  type PublicStatus,
  type PublicStatusDay,
} from "@scanpal/shared";

/**
 * Publieke statuspagina (plan 57): read-only data-builder gedeeld door de
 * SSR-pagina en de JSON-feed (`/api/public/status/[slug]`). Alleen uptime-
 * data uit `sites` + `uptime_events` + `uptime_daily` — bewust geen
 * findings/scores/PII. Retourneert null wanneer de slug niet bestaat
 * (publieke route → 404, geen existence-leak).
 */

type SiteRow = {
  id: string;
  url: string;
  uptime_state: "up" | "down" | "unknown";
};

type DailyRow = {
  day: string;
  checks: number;
  failures: number;
};

type EventRow = {
  checked_at: Date;
  status: "up" | "down";
};

type IncidentRow = {
  start: Date;
  end: Date | null;
  error: string | null;
};

type DayAgg = { up: number; total: number };
type DailyAgg = { checks: number; failures: number };

function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function uptimePct(up: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((up / total) * 10000) / 100;
}

/** Dag-aggregatie uit raw events (events bestaan ~30 dagen; oudere zijn gerolluped). */
function aggregateEventsByDay(events: EventRow[]): Map<string, DayAgg> {
  const byDay = new Map<string, DayAgg>();
  for (const e of events) {
    const day = toUtcDay(e.checked_at);
    const agg = byDay.get(day) ?? { up: 0, total: 0 };
    agg.total++;
    if (e.status === "up") agg.up++;
    byDay.set(day, agg);
  }
  return byDay;
}

/** Dagbalk-serie: up = alle checks ok · down = ≥1 mislukt · nodata = geen meting. */
function buildSeries(
  dailyByDay: Map<string, DailyAgg>,
  eventsByDay: Map<string, DayAgg>,
  today: string,
  days: 30 | 90,
): PublicStatusDay[] {
  const result: PublicStatusDay[] = [];
  const todayDate = new Date(`${today}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(todayDate);
    date.setUTCDate(date.getUTCDate() - i);
    const day = toUtcDay(date);

    if (day === today) {
      const e = eventsByDay.get(day);
      result.push({
        day,
        status: e ? (e.up === e.total ? "up" : "down") : "nodata",
      });
      continue;
    }

    const d = dailyByDay.get(day);
    if (d) {
      result.push({ day, status: d.failures > 0 ? "down" : "up" });
    } else {
      const e = eventsByDay.get(day);
      result.push({
        day,
        status: e ? (e.up === e.total ? "up" : "down") : "nodata",
      });
    }
  }
  return result;
}

function percentFor(
  dailyByDay: Map<string, DailyAgg>,
  eventsByDay: Map<string, DayAgg>,
  today: string,
  windowDays: number,
): number | null {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startStr = toUtcDay(start);

  let up = 0;
  let total = 0;
  for (const [day, d] of dailyByDay) {
    if (day >= startStr && day < today) {
      up += d.checks - d.failures;
      total += d.checks;
    }
  }
  const todayEvents = eventsByDay.get(today);
  if (todayEvents) {
    up += todayEvents.up;
    total += todayEvents.total;
  }
  return uptimePct(up, total);
}

/** Incident-detectie: runs van opeenvolgende down-events (islands via window-fns). */
const INCIDENT_SQL = `
  with ev as (
    select checked_at, status, error,
      lag(status) over (order by checked_at) as prev_status
    from uptime_events
    where site_id = $1
  ),
  runs as (
    select checked_at, status, error,
      sum(case when status = 'down' and (prev_status is null or prev_status = 'up')
               then 1 else 0 end) over (order by checked_at) as grp
    from ev
  ),
  down_runs as (
    select grp,
           min(checked_at) as start,
           max(checked_at) as last_down,
           (array_agg(error) filter (where error is not null))[1] as error
    from runs
    where status = 'down'
    group by grp
  )
  select dr.start, u.checked_at as end, dr.error
  from down_runs dr
  left join lateral (
    select checked_at
    from uptime_events u
    where u.site_id = $1 and u.status = 'up' and u.checked_at > dr.last_down
    order by u.checked_at
    limit 1
  ) u on true
  order by dr.start desc
  limit 50`;

export async function getPublicStatus(
  db: Pool,
  slug: string,
  days: 30 | 90 = 30,
): Promise<PublicStatus | null> {
  const site = await db.query<SiteRow>(
    "select id, url, uptime_state from sites where public_status_slug = $1",
    [slug],
  );
  if (site.rowCount === 0) return null;
  const row = site.rows[0];

  const today = new Date();
  const todayStr = toUtcDay(today);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 90);
  const startStr = toUtcDay(start);

  const [dailyResult, eventsResult, incidentsResult] = await Promise.all([
    db.query<DailyRow>(
      `select day, checks, failures
       from uptime_daily
       where site_id = $1 and day >= $2::date
       order by day`,
      [row.id, startStr],
    ),
    db.query<EventRow>(
      `select checked_at, status
       from uptime_events
       where site_id = $1 and checked_at >= $2::date
       order by checked_at`,
      [row.id, startStr],
    ),
    db.query<IncidentRow>(INCIDENT_SQL, [row.id]),
  ]);

  const dailyByDay = new Map<string, DailyAgg>();
  for (const d of dailyResult.rows) {
    dailyByDay.set(d.day, { checks: d.checks, failures: d.failures });
  }

  const eventsByDay = aggregateEventsByDay(eventsResult.rows);

  // Maintenance-gap fallback: dagen < vandaag die (nog) geen `uptime_daily`-rij
  // hebben maar wel events — anders zouden ze ten onrechte als "geen data"
  // tellen (en de percentages onderschatten).
  for (const [day, e] of eventsByDay) {
    if (day < todayStr && !dailyByDay.has(day)) {
      dailyByDay.set(day, { checks: e.total, failures: e.total - e.up });
    }
  }

  return {
    site_host: hostOf(row.url),
    status: row.uptime_state,
    uptime_30d: percentFor(dailyByDay, eventsByDay, todayStr, 30),
    uptime_90d: percentFor(dailyByDay, eventsByDay, todayStr, 90),
    series: buildSeries(dailyByDay, eventsByDay, todayStr, days),
    incidents: incidentsResult.rows.map((r) => ({
      start: r.start.toISOString(),
      end: r.end ? r.end.toISOString() : null,
      error_class: publicErrorClass(r.error),
    })),
  };
}