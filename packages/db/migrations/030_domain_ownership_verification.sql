alter table sites
  add column if not exists ownership_token text,
  add column if not exists ownership_verified_at timestamptz,
  add column if not exists ownership_method text;
