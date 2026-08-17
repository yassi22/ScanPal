-- 022_compliance_checks.sql
-- Plan 61: compliance-pijler — de passieve compliance-checks (cookie-banner,
-- consent-api, privacy-policy, legal-pages, gdpr-signals) schrijven een
-- `checks`-rij met category 'compliance'. De check-constraint uit 016 uitbreiden
-- (nooit een toegepaste migratie wijzigen).

alter table checks drop constraint checks_category_check;
alter table checks add constraint checks_category_check
  check (category in ('http', 'seo', 'aeo', 'github', 'compliance'));

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table checks drop constraint checks_category_check;
-- alter table checks add constraint checks_category_check
--   check (category in ('http', 'seo', 'aeo', 'github'));