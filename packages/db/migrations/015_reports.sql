-- 015_reports.sql
-- Feature: Export-rapporten (plan 10) — opgeslagen PDF/Markdown-downloads

create table reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  scan_id uuid not null references scans(id) on delete cascade,
  format text not null check (format in ('md', 'pdf')),
  filename text not null,
  content bytea not null,
  size_bytes int not null,
  created_at timestamptz not null default now()
);

create index reports_team_created_idx on reports (team_id, created_at desc);
create index reports_site_idx on reports (site_id);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table reports;