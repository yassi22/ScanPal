-- 016_scan_pipeline.sql
-- Feature: Dispatcher — scan-pipeline (plan 27)

-- Per-categorie-scores van de laatste scan (plan 08/27): output-vorm uit
-- packages/shared scoring.ts (categoryScoresSchema). Geschreven door de
-- aggregator via finishScan.
alter table scans add column category_scores jsonb;

-- Eén rij per check-run (besluit 5): workers upserten idempotent op
-- (scan_id, check_id); de aggregator bouwt de finale findings-payload uit
-- deze tabel (concurrente jsonb-writes op scans.findings zouden verloren
-- gaan). `finding` = de volledige v1-finding-payload (packages/shared).
create table checks (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  check_id text not null,
  category text not null check (category in ('http', 'seo', 'aeo', 'github')),
  status text not null check (status in ('pass', 'fail', 'warn', 'info', 'error')),
  severity text,                        -- afgeleid, uit findings-helpers
  finding jsonb,                        -- finding-payload van deze check
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (scan_id, check_id)
);
create index checks_scan_id_idx on checks (scan_id);

-- Rollback (geen down-migraties in deze repo; ter referentie):
-- drop table checks;
-- alter table scans drop column category_scores;