-- 009_api_keys_prefix_index.sql
-- Feature 25 — HMAC-auth (plan 14, uitgesteld): lookup op prefix voor de
-- HMAC-flow (de client stuurt alleen de prefix, niet de full key).
-- `prefix` is uniek per key, maar zonder index is de lookup een seq-scan.

create index idx_api_keys_prefix on api_keys (prefix);
