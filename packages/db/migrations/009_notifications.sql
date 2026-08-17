-- 009_notifications.sql
-- Feature: Notificatiehub (plan 13) — in-app meldingen + voorkeuren
-- (mail gaat via packages/notify; Resend wordt niet in de DB bewaard)

-- Per-user toggles per event-type; ontbrekende rij = default
-- (scan_done uit, alle andere types aan — besluit plan 13).
create table notification_preferences (
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in (
    'scan_done', 'score_drop', 'site_down', 'site_recovered',
    'critical_finding', 'credit_skip', 'scan_failed'
  )),
  enabled boolean not null default true,
  primary key (user_id, type)
);

-- In-app melding per gebruiker. dedup_key uniek per melding: dubbele sends
-- bij retries worden door `on conflict do nothing` weggegooid.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in (
    'scan_done', 'score_drop', 'site_down', 'site_recovered',
    'critical_finding', 'credit_skip', 'scan_failed'
  )),
  title text not null,
  body text not null,
  link text not null,
  payload jsonb not null default '{}'::jsonb,
  dedup_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Bel-badge (ongelezen per user, nieuwste eerst) + pagina (team-lijst).
create index idx_notifications_user_created
  on notifications (user_id, created_at desc);
create index idx_notifications_team_created
  on notifications (team_id, created_at desc);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table notifications;
-- drop table notification_preferences;
