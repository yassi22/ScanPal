-- 005_scan_progress.sql
-- Feature: Scan-progress live (SSE) (plan 06)

-- Per-categorie voortgang tijdens een scan; `progress` (int) blijft de
-- overall-%. Contract in packages/shared (scan-progress.ts).
alter table scans add column progress_details jsonb not null default '{}'::jsonb;

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table scans drop column progress_details;
