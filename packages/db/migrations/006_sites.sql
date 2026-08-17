-- 006_sites.sql
-- Feature: Sites beheren (plan 04)

alter table sites add column github_repo text;
alter table sites add column label text;
alter table sites add column last_scan_id uuid references scans(id) on delete set null;
alter table sites add column last_scan_status text check (last_scan_status in ('queued', 'running', 'completed', 'failed'));
alter table sites add column last_scan_score int;
alter table sites add column last_scanned_at timestamptz;
alter table sites add column uptime_state text not null default 'unknown' check (uptime_state in ('up', 'down', 'unknown'));

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table sites drop column uptime_state;
-- alter table sites drop column last_scanned_at;
-- alter table sites drop column last_scan_score;
-- alter table sites drop column last_scan_status;
-- alter table sites drop column last_scan_id;
-- alter table sites drop column label;
-- alter table sites drop column github_repo;
