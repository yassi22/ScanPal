-- 019_public_status.sql
-- Feature: Publieke statuspagina (plan 57) — `sites.public_status_slug`
-- Willekeurige, niet-rabare slug die de publieke statuspagina + JSON-feed
-- ontsluit (opt-in per site via de "Publiek maken"-toggle). Nullable zodat
-- sites zonder publieke pagina gewoon meerdere NULLs hebben; uniek alleen
-- waar niet-null (partial unique index).

alter table sites add column public_status_slug text;
create unique index sites_public_status_slug_key
  on sites (public_status_slug)
  where public_status_slug is not null;

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop index sites_public_status_slug_key;
-- alter table sites drop column public_status_slug;