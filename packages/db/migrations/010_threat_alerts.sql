-- 010_threat_alerts.sql
-- Feature: Threat-alerts (plan 12) — honeypot + patroon-detectie

-- Eén honeypot per site: geheime token-URL (GET /h/<token>) die de klant
-- verborgen op de site plaatst; elke hit is een probe/attack.
create table threat_honeypots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references sites(id) on delete cascade,
  token text not null unique,
  enabled boolean not null default true,
  hit_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Elke honeypot-hit is een event (kind='hit'); patroon-matches krijgen
-- kind='pattern' plus matched_rule + risk. Team-scoped voor paneel-queries.
create table threat_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  honeypot_id uuid not null references threat_honeypots(id) on delete cascade,
  kind text not null check (kind in ('hit', 'pattern')),
  risk text not null default 'low' check (risk in ('low', 'medium', 'high', 'critical')),
  path text not null,
  ip inet,
  user_agent text,
  country text,
  asn text,
  matched_rule text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexen voor de team-scoped paneel-query en de analyse (burst/IP).
create index idx_threat_events_team_created
  on threat_events (team_id, created_at desc);
create index idx_threat_events_site
  on threat_events (site_id, created_at desc);
create index idx_threat_events_ip
  on threat_events (ip, created_at desc);

-- Regel-catalog: de inline-analyse leest hieruit (alleen enabled regels);
-- risk per regel wordt op het event gezet.
create table threat_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_key text not null unique,
  risk text not null check (risk in ('low', 'medium', 'high', 'critical')),
  description text not null,
  enabled boolean not null default true
);

insert into threat_rules (name, rule_key, risk, description) values
  ('Burst-detectie', 'burst', 'medium',
   'Meer dan 5 hits vanaf hetzelfde IP binnen 60 seconden.'),
  ('Verdacht beheerpad', 'path_admin', 'medium',
   'Verzoek naar een bekend beheerpad (wp-login, admin, phpmyadmin e.d.).'),
  ('Omgevingsbestanden', 'path_env', 'high',
   'Verzoek naar een omgevings- of geheim-bestand (.env, config, credentials, .git).'),
  ('Path traversal', 'path_traversal', 'critical',
   'Path-traversal-patroon (../ of gecodeerde variant) in het pad.'),
  ('Scanner user-agent', 'ua_scanner', 'low',
   'User-agent van een bekende scanner-tool (sqlmap, nikto, nmap e.d.).'),
  ('IP-herhaling', 'ip_repeat', 'medium',
   'Meer dan 3 hits vanaf hetzelfde IP binnen 24 uur.');

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table threat_rules;
-- drop table threat_events;
-- drop table threat_honeypots;
