-- 029_notification_types_scan_diff_domain_alert.sql
-- Voeg `scan_diff` en `domain_alert` toe aan alle CHECK-constraints op
-- notification-types. De shared-contract (notificationTypeSchema) kent beide
-- al, maar de DB-constraints (laatst gewijzigd in 012_billing_admin) lieten
-- ze weg — inserts faalden met een constraint-violation.

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'scan_done', 'score_drop', 'scan_diff', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed', 'domain_alert'
));

alter table notification_preferences drop constraint if exists notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'scan_done', 'score_drop', 'scan_diff', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed', 'domain_alert'
));

alter table webhooks drop constraint if exists webhooks_events_check;
alter table webhooks add constraint webhooks_events_check check (events <@ array[
  'scan_done', 'score_drop', 'scan_diff', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed', 'domain_alert'
]::text[]);

alter table webhook_deliveries drop constraint if exists webhook_deliveries_event_check;
alter table webhook_deliveries add constraint webhook_deliveries_event_check check (event in (
  'scan_done', 'score_drop', 'scan_diff', 'site_down', 'site_recovered',
  'critical_finding', 'credit_skip', 'scan_failed', 'webhook_disabled',
  'payment_failed', 'domain_alert', 'test'
));
