-- 012_billing_admin.sql
-- Feature: Facturen/abonnement-beheer (plan 16) — in-app opzeggen/hervatten
-- (cancel_at_period_end) en maand/jaar-abonnementen. Facturen worden live uit
-- de Stripe-API gehaald (geen lokale tabel); betaalmethode ook live.

alter table subscriptions add column cancel_at_period_end boolean not null default false;

-- interval: 'month' of 'year' (Stripe price → interval-resolutie in de
-- webhook-sync; display-only, het prijsmodel blijft één pro-plan).
alter table subscriptions add column interval text not null default 'month'
  check (interval in ('month', 'year'));

-- payment_failed is een nieuw notificatie-type (plan 13/16): de check
-- constraints van notifications + notification_preferences breiden uit,
-- net als de webhook-event-check van plan 15 (webhooks kunnen dit event
-- ook selecteren als delivery-event).
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'scan_done', 'score_drop', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed'
));

alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'scan_done', 'score_drop', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed'
));

alter table webhooks drop constraint webhooks_events_check;
alter table webhooks add constraint webhooks_events_check check (events <@ array[
  'scan_done', 'score_drop', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed'
]::text[]);

alter table webhook_deliveries drop constraint webhook_deliveries_event_check;
alter table webhook_deliveries add constraint webhook_deliveries_event_check check (event in (
  'scan_done', 'score_drop', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed', 'test'
));
