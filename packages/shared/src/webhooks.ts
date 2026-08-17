import { z } from "zod";
import { notificationTypeSchema, notificationTypes } from "./notifications";

/**
 * Outbound webhooks (plan 15, feature 15 + 23): de 7 notificatie-types +
 * webhook_disabled als selecteerbare events, plus `test` (alleen als
 * delivery-event van de test-knop, nooit als subscription).
 */
export const webhookEventTypeSchema = z.enum([
  ...notificationTypes,
  "test",
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

/** Events die een webhook kan abonneren (notificatie-types, geen `test`). */
export const webhookEventsSchema = z
  .array(notificationTypeSchema)
  .min(1, "Kies minimaal één event")
  .max(8)
  .refine((events) => new Set(events).size === events.length, {
    message: "Dubbele events zijn niet toegestaan",
  });
export type WebhookEvents = z.infer<typeof webhookEventsSchema>;

export const webhookCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Naam is verplicht")
    .max(80, "Maximaal 80 tekens"),
  url: z
    .string()
    .trim()
    .url("Voer een geldige URL in")
    .max(2048, "URL is te lang"),
  events: webhookEventsSchema,
});
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;

export const webhookUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Naam is verplicht")
      .max(80, "Maximaal 80 tekens")
      .optional(),
    url: z
      .string()
      .trim()
      .url("Voer een geldige URL in")
      .max(2048, "URL is te lang")
      .optional(),
    events: webhookEventsSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Geef minimaal één veld om te wijzigen",
  });
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;

/** Zonder secret — die is alleen bij create/rotate 1× zichtbaar. */
export const webhookViewSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  name: z.string(),
  url: z.string(),
  events: z.array(notificationTypeSchema),
  active: z.boolean(),
  failure_count: z.number().int().min(0),
  last_delivery_at: z.string().datetime().nullable(),
  last_http_status: z.number().int().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type WebhookView = z.infer<typeof webhookViewSchema>;

export const webhookCreatedSchema = z.object({
  webhook: webhookViewSchema,
  secret: z.string(),
});
export type WebhookCreated = z.infer<typeof webhookCreatedSchema>;

export const webhookListResponseSchema = z.object({
  webhooks: z.array(webhookViewSchema),
});
export type WebhookListResponse = z.infer<typeof webhookListResponseSchema>;

export const webhookDeliveryStatusSchema = z.enum([
  "pending",
  "ok",
  "failed",
  "rejected",
  "disabled",
]);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

export const webhookDeliveryViewSchema = z.object({
  id: z.string().uuid(),
  webhook_id: z.string().uuid(),
  event: webhookEventTypeSchema,
  status: webhookDeliveryStatusSchema,
  http_status: z.number().int().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int().min(0),
  next_attempt_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  delivered_at: z.string().datetime().nullable(),
});
export type WebhookDeliveryView = z.infer<typeof webhookDeliveryViewSchema>;

export const webhookDeliveriesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type WebhookDeliveriesListQuery = z.infer<
  typeof webhookDeliveriesListQuerySchema
>;

export const webhookDeliveriesListResponseSchema = z.object({
  deliveries: z.array(webhookDeliveryViewSchema),
  total: z.number().int().min(0),
});
export type WebhookDeliveriesListResponse = z.infer<
  typeof webhookDeliveriesListResponseSchema
>;

export const webhookTestResponseSchema = z.object({
  delivery: webhookDeliveryViewSchema,
});
export type WebhookTestResponse = z.infer<typeof webhookTestResponseSchema>;

/** Outbound payload v1 (besluit plan 15): envelop + data = notify-payload. */
export const webhookEnvelopeSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  event: webhookEventTypeSchema,
  created_at: z.string().datetime(),
  team_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/** Max payload per delivery (open vraag plan 15, voorstel 256 KB). */
export const WEBHOOK_MAX_PAYLOAD_BYTES = 256 * 1024;
