-- 011_webhooks.sql
-- Feature: Outbound webhooks (plan 15) — teams configureren eigen endpoints
-- die bij elk notificatie-event een JSON-payload krijgen (HMAC-gesigneerd,
-- AES-GCM-encrypted secrets). Bezorging loopt via een outbox die de
-- deliverer verstuurt (scheduler-loop; na Fase 3 BullMQ-queue webhook.deliver).

-- De events-check sluit het volledige notificatie-typeset in (incl.
-- webhook_disabled); `test` wordt nooit als subscription opgeslagen (alleen
-- als delivery-event van de test-knop).
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  name text not null,
  url text not null,
  -- AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>" (base64url); de plaintext is
  -- alleen bij creatie/rotatie 1× zichtbaar (zelfde pattern als plan 58).
  secret_encrypted text not null,
  events text[] not null default '{}'::text[] check (events <@ array[
    'scan_done', 'score_drop', 'site_down', 'site_recovered',
    'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled'
  ]::text[]),
  active boolean not null default true,
  failure_count int not null default 0,
  last_delivery_at timestamptz,
  last_http_status int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Delivery-outbox. De unieke dedup_key per (webhook, event, entity,
-- incident) maakt retries en dubbele events onschadelijk: max 1 delivery
-- per event per webhook.
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event text not null check (event in (
    'scan_done', 'score_drop', 'site_down', 'site_recovered',
    'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled', 'test'
  )),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending', 'ok', 'failed', 'rejected', 'disabled'
  )),
  http_status int,
  error text,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  dedup_key text not null unique,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

-- Team-lijst (settings) + deliverer-poll op due rijen + delivery-log.
create index idx_webhooks_team on webhooks (team_id);
create index idx_webhook_deliveries_due
  on webhook_deliveries (status, next_attempt_at);
create index idx_webhook_deliveries_webhook_created
  on webhook_deliveries (webhook_id, created_at desc);

-- webhook_disabled is een nieuw notificatie-type (plan 13/15): de check
-- constraints van notifications + notification_preferences breiden uit
-- (constraint-namen zijn de Postgres-defaults van migratie 009).
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'scan_done', 'score_drop', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled'
));

alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'scan_done', 'score_drop', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled'
));

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table webhook_deliveries;
-- drop table webhooks;
