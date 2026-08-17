-- 013_scan_cancel.sql
-- Feature: scans cancelen (plan 19)

alter table scans drop constraint scans_status_check;
alter table scans add constraint scans_status_check
  check (status in ('queued', 'running', 'completed', 'failed', 'canceled'));

alter table sites drop constraint sites_last_scan_status_check;
alter table sites add constraint sites_last_scan_status_check
  check (last_scan_status in ('queued', 'running', 'completed', 'failed', 'canceled'));