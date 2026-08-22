-- 028_rls_sites_webhooks_reports.sql
-- RLS op sites, webhooks, reports, scans, checks, scan_routes (review-blocker).
-- Volgt hetzelfde patroon als 024_rls_policies: teamleden lezen team-data via
-- is_team_member(). De privileged app-pool (BYPASSRLS) wordt niet geraakt;
-- dit beschermt zodra een niet-bypassende rol (bijv. PostgREST anon/auth) de
-- tabellen leest.

alter table sites enable row level security;
alter table scans enable row level security;
alter table checks enable row level security;
alter table scan_routes enable row level security;
alter table webhooks enable row level security;
alter table webhook_deliveries enable row level security;
alter table webhook_events enable row level security;
alter table reports enable row level security;

-- sites: teamleden lezen sites van hun team.
create policy sites_select_member on sites
  for select using (public.is_team_member(team_id));

-- scans: teamleden lezen scans (via site → team).
create policy scans_select_member on scans
  for select using (
    exists (
      select 1 from sites s
      where s.id = scans.site_id
        and public.is_team_member(s.team_id)
    )
  );

-- checks: teamleden lezen checks (via scan → site → team).
create policy checks_select_member on checks
  for select using (
    exists (
      select 1 from scans sc
      join sites s on s.id = sc.site_id
      where sc.id = checks.scan_id
        and public.is_team_member(s.team_id)
    )
  );

-- scan_routes: teamleden lezen routes (via scan → site → team).
create policy scan_routes_select_member on scan_routes
  for select using (
    exists (
      select 1 from scans sc
      join sites s on s.id = sc.site_id
      where sc.id = scan_routes.scan_id
        and public.is_team_member(s.team_id)
    )
  );

-- webhooks: teamleden lezen webhooks van hun team.
create policy webhooks_select_member on webhooks
  for select using (public.is_team_member(team_id));

-- webhook_deliveries: teamleden lezen deliveries (via webhook → team).
create policy webhook_deliveries_select_member on webhook_deliveries
  for select using (
    exists (
      select 1 from webhooks w
      where w.id = webhook_deliveries.webhook_id
        and public.is_team_member(w.team_id)
    )
  );

-- webhook_events (inbound Stripe/GitHub/Vercel): geen team_id-kolom; default-deny
-- voor niet-bypassende rollen (de app-pool leest/schrijft via BYPASSRLS).

-- reports: teamleden lezen reports van hun team.
create policy reports_select_member on reports
  for select using (public.is_team_member(team_id));
