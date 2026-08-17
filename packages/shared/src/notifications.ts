import { z } from "zod";

export const notificationTypeSchema = z.enum([
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
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationTypes: NotificationType[] = [
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
];

export const notificationViewSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  link: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  read_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type NotificationView = z.infer<typeof notificationViewSchema>;

export const notificationsListQuerySchema = z.object({
  unread: z.coerce.boolean().optional(),
  type: notificationTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type NotificationsListQuery = z.infer<typeof notificationsListQuerySchema>;

export const notificationsListResponseSchema = z.object({
  notifications: z.array(notificationViewSchema),
  unread: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type NotificationsListResponse = z.infer<
  typeof notificationsListResponseSchema
>;

export const markReadResponseSchema = z.object({
  notification: notificationViewSchema,
});
export type MarkReadResponse = z.infer<typeof markReadResponseSchema>;

export const readAllResponseSchema = z.object({
  updated: z.number().int().min(0),
});
export type ReadAllResponse = z.infer<typeof readAllResponseSchema>;

export const notificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const notificationPreferencesResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
});
export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>;

export const notificationPreferenceUpdateSchema = z.object({
  type: notificationTypeSchema,
  enabled: z.boolean(),
});
export type NotificationPreferenceUpdate = z.infer<
  typeof notificationPreferenceUpdateSchema
>;
