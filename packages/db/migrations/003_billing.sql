-- 003_billing.sql
-- Feature: Pricing + Stripe + credits (plan 03)

create table if not exists subscriptions (
  team_id uuid primary key references teams(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  current_period_end timestamptz,
  credits_used int not null default 0 check (credits_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_stripe_customer_idx
  on subscriptions(stripe_customer_id) where stripe_customer_id is not null;

create unique index if not exists subscriptions_stripe_subscription_idx
  on subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  amount int not null,
  reason text not null,
  scan_id uuid references scans(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_team_idx
  on credit_transactions(team_id, created_at desc);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type text not null,
  created_at timestamptz not null default now()
);
