-- 026_team_seats_white_label.sql
-- Feature: Team seats, client workspaces + white-label (plan 64) — data model
-- voor het Max-plan: `teams.branding` (logo/kleur/naam/hide-branding per team),
-- client-`workspaces` (sub-ruimten onder een team waaraan sites + memberships
-- gekoppeld kunnen worden, klantportaal-scoping) en een token-gebaseerd
-- rapport-portaal op `scans.report_token` (public read-only, gebrandingd).

alter table teams add column branding jsonb not null default '{}'::jsonb;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  parent_team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index workspaces_parent_team_id_idx on workspaces(parent_team_id);

alter table sites add column workspace_id uuid references workspaces(id) on delete set null;
create index sites_workspace_id_idx on sites(workspace_id);

alter table memberships add column workspace_id uuid references workspaces(id) on delete set null;
create index memberships_workspace_id_idx on memberships(workspace_id);

-- Portaal-tokens: nullable zodat sites/zonder gedeeld rapport gewoon NULL
-- hebben; uniek alleen waar niet-null (partial unique index, zelfde stijl als
-- sites_public_status_slug_key in 019).
alter table scans add column report_token text;
alter table scans add column report_token_expires_at timestamptz;
create unique index scans_report_token_key
  on scans (report_token)
  where report_token is not null;

-- Max-plan toevoegen aan de abonnement-plan-check (was ('free','pro')).
alter table subscriptions drop constraint subscriptions_plan_check;
alter table subscriptions add constraint subscriptions_plan_check
  check (plan in ('free', 'pro', 'max'));

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table subscriptions drop constraint subscriptions_plan_check;
-- alter table subscriptions add constraint subscriptions_plan_check check (plan in ('free', 'pro'));
-- drop index scans_report_token_key;
-- alter table scans drop column report_token_expires_at;
-- alter table scans drop column report_token;
-- drop index memberships_workspace_id_idx;
-- alter table memberships drop column workspace_id;
-- drop index sites_workspace_id_idx;
-- alter table sites drop column workspace_id;
-- drop index workspaces_parent_team_id_idx;
-- drop table workspaces;
-- alter table teams drop column branding;
