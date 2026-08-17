-- 004_scan_triggers.sql
-- Feature: Scan triggeren (direct / dagelijks / wekelijks) (plan 05)

alter table sites add column scan_frequency text not null default 'none'
  check (scan_frequency in ('none', 'daily', 'weekly'));
alter table sites add column next_scan_at timestamptz;

create index if not exists sites_due_scans_idx
  on sites (next_scan_at) where scan_frequency != 'none';

alter table scans add column trigger text not null default 'manual'
  check (trigger in ('manual', 'schedule'));
alter table scans add column scheduled_for timestamptz;

create index if not exists scans_site_status_idx on scans (site_id, status);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table scans drop column scheduled_for;
-- alter table scans drop column trigger;
-- drop index scans_site_status_idx;
-- drop index sites_due_scans_idx;
-- alter table sites drop column next_scan_at;
-- alter table sites drop column scan_frequency;
