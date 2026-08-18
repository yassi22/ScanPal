-- 027_scan_crux_default_null.sql
-- Plan 62, besluit 3: "geen data → null". Migratie 025 zette `crux` op
-- `default '{}'`, maar dat lekt als valse lege waarde door naar het
-- scan-contract (cruxDataSchema faalt op '{}'). Default → null en bestaande
-- lege objecten terugzetten naar null. De http-worker schrijft expliciet
-- `writeScanCrux` (null = geen CrUX-dekking).

alter table scans alter column crux drop not null;
alter table scans alter column crux set default null;

update scans set crux = null where crux = '{}'::jsonb;

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table scans alter column crux set default '{}'::jsonb;
-- alter table scans alter column crux set not null;