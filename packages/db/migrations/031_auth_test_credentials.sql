-- 031_auth_test_credentials.sql
-- Plan 77: encrypted opslag van het wegwerp-testaccount per site, voor de
-- authentication flow scanner. Tenant-isolated (team_id + optioneel
-- workspace_id); password AES-256-GCM versleuteld at rest (scan-core
-- credentials.ts). Eén rij per site (unique site_id). RLS volgt het patroon
-- van 028: teamleden lezen/schrijven via is_team_member().

create table if not exists site_auth_credentials (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  workspace_id uuid references workspaces (id) on delete cascade,
  site_id uuid not null references sites (id) on delete cascade,
  login_url text,
  username text not null,
  password_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id)
);

create index if not exists site_auth_credentials_team_idx
  on site_auth_credentials (team_id);

alter table site_auth_credentials enable row level security;

create policy site_auth_credentials_select_member on site_auth_credentials
  for select using (public.is_team_member(team_id));

create policy site_auth_credentials_modify_member on site_auth_credentials
  for all
  using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id));
