-- 007_uptime.sql
-- Feature: Uptime-dashboard (plan 11) — poller (50), routes (24), dashboard (11)

-- Raw probe-events; 30 dagen bewaard, daarna dag-aggregaat (uptime_daily).
create table uptime_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('up', 'down')),
  latency_ms int,
  status_code int,
  error text
);

create table uptime_daily (
  site_id uuid not null references sites(id) on delete cascade,
  day date not null,
  checks int not null default 0,
  failures int not null default 0,
  avg_latency_ms numeric,
  p95_latency_ms numeric,
  primary key (site_id, day)
);

-- Index voor de team-scoped grafiek-query (site + tijd).
create index idx_uptime_events_site_checked
  on uptime_events (site_id, checked_at desc);

-- "Down sinds"-weergave + per-site monitoring-toggle.
alter table sites add column uptime_state_changed_at timestamptz;
alter table sites add column uptime_enabled boolean not null default true;

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table sites drop column uptime_enabled;
-- alter table sites drop column uptime_state_changed_at;
-- drop table uptime_daily;
-- drop table uptime_events;
