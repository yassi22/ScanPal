-- 024_rls_policies.sql
-- Row Level Security (defense-in-depth, review-blocker 03.3).
--
-- Achtergrond: de app leest/schrijft via één privileged pool-rol
-- (env.databaseUrl; lokaal de superuser uit POSTGRES_USER, op Supabase de
-- `postgres`-directe connectie). Die rol heeft BYPASSRLS en is niet geraakt.
-- RLS beschermt hier dezelfde data zodra die ooit via een niet-bypassende
-- rol wordt gelezen (bijv. Supabase PostgREST met anon/authenticated).
-- Policies volgen de app-laag-regels: teamleden lezen team-data; owners
-- beheren api_keys. Tabellen zonder policy (api_keys/api_key_usage) zijn
-- default-deny voor niet-bypassende rollen.

-- auth.uid() bestaat op Supabase; op de lokale/dev-Postgres maken we een
-- stub die dezelfde JWT-claim (request.jwt.claim.sub) uitleest — Supabase's
-- eigen functie wordt nooit overschreven.
do $do$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create schema if not exists auth;
    create function auth.uid() returns uuid
    language sql stable
    as $func$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $func$;
  end if;
end
$do$;

-- Membership-check zonder recursie in policies: security definer draait als
-- eigenaar (omzeilt RLS op memberships zelf).
create or replace function public.is_team_member(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.team_id = target_team_id
      and m.user_id = auth.uid()
      and m.status = 'accepted'
  );
$$;

create or replace function public.is_team_owner(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.team_id = target_team_id
      and m.user_id = auth.uid()
      and m.status = 'accepted'
      and m.role = 'owner'
  );
$$;

alter table users enable row level security;
alter table teams enable row level security;
alter table memberships enable row level security;
alter table subscriptions enable row level security;
alter table api_keys enable row level security;
alter table api_key_usage enable row level security;

-- users: alleen de eigen rij.
create policy users_select_own on users
  for select using (id = auth.uid());

-- teams: alleen leden lezen hun team.
create policy teams_select_member on teams
  for select using (public.is_team_member(id));

-- memberships: eigen lidmaatschap + dat van teamgenoten (ledengids).
create policy memberships_select_member on memberships
  for select using (
    user_id = auth.uid()
    or public.is_team_member(team_id)
  );

-- subscriptions: teamleden lezen de abonnement-rij van hun team.
create policy subscriptions_select_member on subscriptions
  for select using (public.is_team_member(team_id));

-- api_keys / api_key_usage: bewust géén select-policy voor leden (key_hash
-- en usage-tellingen mogen niet via PostgREST lekken); default-deny behalve
-- voor de privileged app-pool. Owners lezen via de app (requireOwner).
