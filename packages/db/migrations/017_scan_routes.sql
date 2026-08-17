-- 017_scan_routes.sql
-- Feature: Route-discovery + per-route checks (plan 54)

-- Genormaliseerde, gededupliceerde routes per scan (besluit 2). Bron =
-- sitemap | link | spa | seed; `http_status` wordt tijdens de check-fase
-- ingevuld. Geen JSONB — filterbaar in UI en querybaar.
create table scan_routes (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  url text not null,
  source text not null check (source in ('sitemap', 'link', 'spa', 'seed')),
  http_status integer,
  created_at timestamptz not null default now(),
  unique (scan_id, url)
);
create index scan_routes_scan_id_idx on scan_routes (scan_id);

-- Denormaliseerde routeteller voor de scan-lijst / resultatenpagina (besluit 2).
alter table scans add column route_count integer not null default 0;

-- Per-route findings: één `checks`-rij per (scan, check, route) (besluit 5).
-- `route_url` is de genormaliseerde pagina-URL waarop de check draaide
-- (NULL voor site-level checks zoals github). De oude unieke constraint op
-- (scan_id, check_id) wordt vervangen door een triple; NULL-route_url rijen
-- vallen buiten de nieuwe constraint (github-checks zijn idempotent via de
-- jobId op queue-niveau en worden door de worker eerst gewist bij een re-run).
alter table checks add column route_url text;
alter table checks drop constraint if exists checks_scan_id_check_id_key;
create unique index checks_scan_check_route_idx
  on checks (scan_id, check_id, route_url)
  where route_url is not null;
create unique index checks_scan_check_idx
  on checks (scan_id, check_id)
  where route_url is null;
create index if not exists checks_route_url_idx on checks (scan_id, route_url);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table scan_routes;
-- alter table scans drop column route_count;
-- drop index checks_route_url_idx;
-- drop index checks_scan_check_idx;
-- drop index checks_scan_check_route_idx;
-- alter table checks drop column route_url;
-- alter table checks add constraint checks_scan_id_check_id_key unique (scan_id, check_id);
