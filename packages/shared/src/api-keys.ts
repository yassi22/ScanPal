import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Naam is verplicht")
    .max(80, "Maximaal 80 tekens"),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/**
 * API-key zonder full key (die is 1× zichtbaar bij creatie).
 * De hash wordt nooit via de API geëxposeerd.
 */
export const apiKeyViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  last_used_at: z.string().datetime().nullable(),
  revoked_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type ApiKeyView = z.infer<typeof apiKeyViewSchema>;

export const apiKeyCreatedSchema = z.object({
  key: apiKeyViewSchema,
  full_key: z.string(),
});
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;

export const apiKeyListResponseSchema = z.object({
  keys: z.array(apiKeyViewSchema),
});
export type ApiKeyListResponse = z.infer<typeof apiKeyListResponseSchema>;
