-- 023_domain_watch_backfill.sql
-- Feature: Domain watchtower (plan 56) — bootstrap-fix. `next_domain_check_at`
-- werd alleen door `applyDomainMeasurement` gezet, die zelf pas draait als de
-- poll een due-site vindt (deadlock: geen enkele site was ooit due). Backfill
-- maakt álle bestaande sites meteen due; nieuwe sites krijgen het default
-- `now()` bij insert (sites-core), zodat de dagelijkse watch direct live is.

update sites
   set next_domain_check_at = now()
 where next_domain_check_at is null;
