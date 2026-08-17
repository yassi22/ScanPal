-- 008_api_keys.sql
-- Feature: API-keys (plan 14) — bearer-auth voor de REST API + MCP-server
-- (feature 25), met rate limiting en usage-tracking (deel van feature 26).

-- Statische keys met prefix `sp_live_`; de DB slaat alleen sha256(key) op
-- (key_hash) — de full key is 1× zichtbaar bij creatie.
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Dag-teller per key (daily counters, feature 26/plan 14).
create table api_key_usage (
  key_id uuid not null references api_keys(id) on delete cascade,
  day date not null,
  request_count int not null default 0,
  primary key (key_id, day)
);

-- Auth-lookup op key_hash (Bearer) + team-lijst (settings/API-keys).
create index idx_api_keys_key_hash on api_keys (key_hash);
create index idx_api_keys_team on api_keys (team_id);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table api_key_usage;
-- drop table api_keys;
