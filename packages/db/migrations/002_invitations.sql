-- 002_invitations.sql
-- Feature: Team-uitnodigingen + rollen (plan 02)

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  token text not null unique,
  expires_at timestamptz not null,
  invited_by uuid references users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists invitations_pending_unique
  on invitations (team_id, lower(email)) where accepted_at is null;

create index if not exists invitations_token_idx on invitations(token);
