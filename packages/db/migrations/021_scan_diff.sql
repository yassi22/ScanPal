-- 021_scan_diff.sql
-- Feature: Diff-gebaseerde monitoring (plan 59)

-- Diff t.o.v. de laatste schone snapshot, geschreven door de aggregator bij
-- elke voltooide scan. Contract: packages/shared diff.ts (scanDiffSchema).
-- '{}' = nog geen diff berekend (legacy/failed scans).
alter table scans add column diff jsonb not null default '{}';

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table scans drop column diff;