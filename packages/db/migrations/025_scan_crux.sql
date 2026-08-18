-- 025_scan_crux.sql
-- Plan 62: CrUX field data (real-user CWV) naast lab-metingen. De http-worker
-- schrijft het genormaliseerde resultaat van de CrUX-API-call in `scans.crux`
-- (contract: packages/shared/src/crux.ts). Geen data → null (besluit 3:
-- geen score-straf, wel een info-finding). Trends (10) lezen hetzelfde veld.

alter table scans add column crux jsonb not null default '{}'::jsonb;

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table scans drop column crux;
