-- 001_users_teams_memberships.sql
-- Feature: Onboarding & account (plan 01)

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  email text not null unique,
  name text,
  avatar_url text,
  auth_provider text,
  last_login_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'accepted' check (status in ('pending', 'accepted')),
  invited_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists memberships_user_id_idx on memberships(user_id);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now(),
  unique (team_id, url)
);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  progress int not null default 0,
  score int,
  findings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists scans_site_id_idx on scans(site_id);
