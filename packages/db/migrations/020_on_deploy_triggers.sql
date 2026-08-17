-- 020_on_deploy_triggers.sql
-- Feature: On-deploy triggers (plan 58) — GitHub/Vercel webhooks → automatische
-- herscan. `sites.github_webhook_secret` houdt het per-site GitHub-webhook-
-- secret (AES-GCM versleuteld, key in env WEBHOOK_SECRET_KEY); null = de site
-- heeft de webhook (nog) niet geconfigureerd. De `scans.trigger`-constraint
-- breidt uit met 'deploy' zodat webhook-scans traceerbaar zijn als
-- automatische triggers (deel van het scan-levenscycluscontract).

alter table sites add column github_webhook_secret text;

alter table scans drop constraint if exists scans_trigger_check;
alter table scans add constraint scans_trigger_check
  check (trigger in ('manual', 'schedule', 'deploy'));

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- alter table scans drop constraint scans_trigger_check;
-- alter table scans add constraint scans_trigger_check
--   check (trigger in ('manual', 'schedule'));
-- alter table sites drop column github_webhook_secret;