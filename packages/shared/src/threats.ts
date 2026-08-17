import { z } from "zod";

export const threatRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export type ThreatRisk = z.infer<typeof threatRiskSchema>;

export const threatEventKindSchema = z.enum(["hit", "pattern"]);
export type ThreatEventKind = z.infer<typeof threatEventKindSchema>;

export const threatRuleKeySchema = z.enum([
  "burst",
  "path_admin",
  "path_env",
  "path_traversal",
  "ua_scanner",
  "ip_repeat",
]);
export type ThreatRuleKey = z.infer<typeof threatRuleKeySchema>;

/** Eén honeypot-hit / patroon-match. `kind='pattern'` heeft `matched_rule` + risk. */
export const threatEventSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  site_id: z.string().uuid(),
  honeypot_id: z.string().uuid(),
  kind: threatEventKindSchema,
  risk: threatRiskSchema,
  path: z.string(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  country: z.string().nullable(),
  asn: z.string().nullable(),
  matched_rule: threatRuleKeySchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
});
export type ThreatEvent = z.infer<typeof threatEventSchema>;

export const threatRuleViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rule_key: threatRuleKeySchema,
  risk: threatRiskSchema,
  description: z.string(),
});
export type ThreatRuleView = z.infer<typeof threatRuleViewSchema>;

/** Honeypot per site zoals het paneel die toont (incl. install-URL). */
export const threatHoneypotViewSchema = z.object({
  site_id: z.string().uuid(),
  site_url: z.string(),
  site_label: z.string().nullable(),
  honeypot_id: z.string().uuid(),
  enabled: z.boolean(),
  url: z.string(),
  path: z.string(),
  hit_count: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
});
export type ThreatHoneypotView = z.infer<typeof threatHoneypotViewSchema>;

/** Overzicht per site voor het threats-paneel. */
export const threatOverviewSchema = z.object({
  site: threatHoneypotViewSchema,
  last_event: threatEventSchema.nullable(),
  high_risk_count: z.number().int().nonnegative(),
  active_patterns: z.array(threatRuleKeySchema),
});
export type ThreatOverview = z.infer<typeof threatOverviewSchema>;

export const threatOverviewResponseSchema = z.object({
  sites: z.array(threatOverviewSchema),
});
export type ThreatOverviewResponse = z.infer<typeof threatOverviewResponseSchema>;

export const threatEventsQuerySchema = z.object({
  site_id: z.string().uuid().optional(),
  risk: threatRiskSchema.optional(),
  kind: threatEventKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});
export type ThreatEventsQuery = z.infer<typeof threatEventsQuerySchema>;

export const threatEventsResponseSchema = z.object({
  events: z.array(threatEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
});
export type ThreatEventsResponse = z.infer<typeof threatEventsResponseSchema>;

export const updateHoneypotSchema = z.object({
  enabled: z.boolean(),
  rotate_token: z.boolean().optional().default(false),
});
export type UpdateHoneypot = z.infer<typeof updateHoneypotSchema>;

/** Install-snippet: verborgen link die de klant op de site plaatst. */
export const honeypotSnippetSchema = z.object({
  html: z.string(),
  url: z.string(),
});
export type HoneypotSnippet = z.infer<typeof honeypotSnippetSchema>;

export const honeypotSetupResponseSchema = z.object({
  honeypot: threatHoneypotViewSchema,
  snippet: honeypotSnippetSchema,
});
export type HoneypotSetupResponse = z.infer<typeof honeypotSetupResponseSchema>;
