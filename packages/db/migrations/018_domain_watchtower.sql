-- 018_domain_watchtower.sql
-- Feature: Domain watchtower (plan 56) — expiry, DNSSEC, CAA, NS-drift, TLS-runway
-- Denormaliseerde domein-status op sites (hot read voor de site-detail-kaart) +
-- `domain_events` als append-only wijzigingslog (bron voor alerts + de
-- 30/90-dagen-weergave). Events worden alleen bij verandering geschreven.

alter table sites add column domain_expiry date;
alter table sites add column domain_registrar text;
alter table sites add column dnssec_enabled boolean;
alter table sites add column caa_present boolean;
alter table sites add column tls_expiry timestamptz;
alter table sites add column domain_last_checked_at timestamptz;
-- Volgende dagelijkse watch-meting (plan 56, stap 3). Nullable zodat sites die
-- nog nooit gemeten zijn niet meetellen in de due-poll.
alter table sites add column next_domain_check_at timestamptz;
create index sites_next_domain_check_at_idx on sites (next_domain_check_at)
  where next_domain_check_at is not null;

create table domain_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  field text not null check (field in ('domain_expiry', 'domain_registrar', 'dnssec_enabled', 'caa_present', 'tls_expiry', 'nameservers', 'caa_records')),
  old_value text,
  new_value text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index domain_events_site_id_idx on domain_events (site_id, checked_at desc);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table domain_events;
-- drop index sites_next_domain_check_at_idx;
-- alter table sites drop column next_domain_check_at;
-- alter table sites drop column domain_last_checked_at;
-- alter table sites drop column tls_expiry;
-- alter table sites drop column caa_present;
-- alter table sites drop column dnssec_enabled;
-- alter table sites drop column domain_registrar;
-- alter table sites drop column domain_expiry;
