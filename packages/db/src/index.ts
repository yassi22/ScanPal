export const userRoles = ["owner", "member"] as const;
export const membershipStatuses = ["pending", "accepted"] as const;
export const scanStatuses = ["queued", "running", "completed", "failed"] as const;
export const scanTriggers = ["manual", "schedule", "deploy"] as const;
export const scanFrequencies = ["none", "daily", "weekly"] as const;
export const planIds = ["free", "pro", "max"] as const;
export const subscriptionStatuses = ["active", "trialing", "past_due", "canceled"] as const;
export const uptimeStates = ["up", "down", "unknown"] as const;
export const uptimeEventStatuses = ["up", "down"] as const;
export const threatRisks = ["low", "medium", "high", "critical"] as const;
export const threatEventKinds = ["hit", "pattern"] as const;
export const threatRuleKeys = [
  "burst",
  "path_admin",
  "path_env",
  "path_traversal",
  "ua_scanner",
  "ip_repeat",
] as const;
export const notificationTypes = [
  "scan_done",
  "score_drop",
  "site_down",
  "site_recovered",
  "critical_finding",
  "credit_skip",
  "scan_failed",
  "webhook_disabled",
  "payment_failed",
  "domain_alert",
] as const;
export const subscriptionIntervals = ["month", "year"] as const;
export const webhookDeliveryStatuses = [
  "pending",
  "ok",
  "failed",
  "rejected",
  "disabled",
] as const;

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  auth_provider: string | null;
  last_login_at: Date | null;
  onboarding_completed_at: Date | null;
  created_at: Date;
};

export type TeamRow = {
  id: string;
  name: string;
  branding: Record<string, unknown>;
  created_at: Date;
};

export type WorkspaceRow = {
  id: string;
  parent_team_id: string;
  name: string;
  created_at: Date;
};

export type MembershipRow = {
  team_id: string;
  user_id: string;
  workspace_id: string | null;
  role: (typeof userRoles)[number];
  status: (typeof membershipStatuses)[number];
  invited_by: string | null;
  created_at: Date;
};

export type SiteRow = {
  id: string;
  team_id: string;
  workspace_id: string | null;
  url: string;
  github_repo: string | null;
  label: string | null;
  last_scan_id: string | null;
  last_scan_status: (typeof scanStatuses)[number] | null;
  last_scan_score: number | null;
  last_scanned_at: Date | null;
  uptime_state: (typeof uptimeStates)[number];
  uptime_state_changed_at: Date | null;
  uptime_enabled: boolean;
  scan_frequency: (typeof scanFrequencies)[number];
  next_scan_at: Date | null;
  ownership_token: string | null;
  ownership_verified_at: Date | null;
  ownership_method: string | null;
  created_at: Date;
};

export const domainEventFields = [
  "domain_expiry",
  "domain_registrar",
  "dnssec_enabled",
  "caa_present",
  "tls_expiry",
  "nameservers",
  "caa_records",
] as const;

export type DomainEventRow = {
  id: string;
  site_id: string;
  field: (typeof domainEventFields)[number];
  old_value: string | null;
  new_value: string | null;
  checked_at: Date;
  created_at: Date;
};

export type ScanRow = {
  id: string;
  site_id: string;
  status: (typeof scanStatuses)[number];
  progress: number;
  progress_details: Record<string, unknown>;
  score: number | null;
  findings: Record<string, unknown>;
  /** Plan 62: CrUX field data (cruxDataSchema uit packages/shared). */
  crux: Record<string, unknown>;
  /** Plan 59: diff t.o.v. de laatste schone snapshot (scanDiffSchema). */
  diff: Record<string, unknown>;
  active_tests: boolean;
  trigger: (typeof scanTriggers)[number];
  scheduled_for: Date | null;
  report_token: string | null;
  report_token_expires_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
};

export type SubscriptionRow = {
  team_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: (typeof planIds)[number];
  status: (typeof subscriptionStatuses)[number];
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  interval: (typeof subscriptionIntervals)[number];
  credits_used: number;
  created_at: Date;
  updated_at: Date;
};

export type CreditTransactionRow = {
  id: string;
  team_id: string;
  amount: number;
  reason: string;
  scan_id: string | null;
  created_at: Date;
};

export type UptimeEventRow = {
  id: string;
  site_id: string;
  checked_at: Date;
  status: (typeof uptimeEventStatuses)[number];
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
};

export type UptimeDailyRow = {
  site_id: string;
  day: string;
  checks: number;
  failures: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
};

export type ThreatHoneypotRow = {
  id: string;
  site_id: string;
  team_id: string;
  token: string;
  enabled: boolean;
  hit_count: number;
  created_at: Date;
};

export type ThreatEventRow = {
  id: string;
  team_id: string;
  site_id: string;
  honeypot_id: string;
  kind: (typeof threatEventKinds)[number];
  risk: (typeof threatRisks)[number];
  path: string;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  asn: string | null;
  matched_rule: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

export type ThreatRuleRow = {
  id: string;
  name: string;
  rule_key: (typeof threatRuleKeys)[number];
  risk: (typeof threatRisks)[number];
  description: string;
  enabled: boolean;
};

export type ApiKeyRow = {
  id: string;
  team_id: string;
  created_by: string;
  name: string;
  prefix: string;
  key_hash: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
};

export type ApiKeyUsageRow = {
  key_id: string;
  day: string;
  request_count: number;
};

export type NotificationPreferenceRow = {
  user_id: string;
  type: (typeof notificationTypes)[number];
  enabled: boolean;
};

export type NotificationRow = {
  id: string;
  team_id: string;
  user_id: string;
  type: (typeof notificationTypes)[number];
  title: string;
  body: string;
  link: string;
  payload: Record<string, unknown>;
  dedup_key: string;
  read_at: Date | null;
  created_at: Date;
};

export type WebhookRow = {
  id: string;
  team_id: string;
  created_by: string;
  name: string;
  url: string;
  secret_encrypted: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_delivery_at: Date | null;
  last_http_status: number | null;
  created_at: Date;
  updated_at: Date;
};

export type ReportRow = {
  id: string;
  team_id: string;
  site_id: string;
  scan_id: string;
  format: "md" | "pdf";
  filename: string;
  content: Buffer;
  size_bytes: number;
  created_at: Date;
};

export type WebhookDeliveryRow = {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: (typeof webhookDeliveryStatuses)[number];
  http_status: number | null;
  error: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  dedup_key: string;
  created_at: Date;
  delivered_at: Date | null;
};
