-- 014_active_tests.sql
-- Feature: Actieve vulnerability-tests (plan 52)

alter table scans add column active_tests boolean not null default false;
alter table sites add column active_tests_enabled boolean not null default false;

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table sites drop column active_tests_enabled;
-- alter table scans drop column active_tests;