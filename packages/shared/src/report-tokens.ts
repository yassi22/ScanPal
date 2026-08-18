import { z } from "zod";

/**
 * Report-token (plan 64): deelbare lees-link naar een scan-rapport zonder
 * inloggen. Token = 32 lowercase hex-tekens (16 bytes entropie), gegenereerd
 * op aanvraag, optioneel verlopend via `expires_at`.
 */

/** Aantal hex-tekens van een report token (16 bytes entropie). */
export const REPORT_TOKEN_LENGTH = 32;

/** Alleen tokens in het generator-formaat: 32 lowercase hex-tekens. */
export const REPORT_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Genereert een niet-rabare report token: 32 lowercase hex-tekens (v4-UUID,
 * 122 bits entropie, alle streepjes verwijderd). Zelfde globale `crypto`-
 * bron en techniek als `generatePublicStatusSlug` in `public-status.ts`.
 */
export function generateReportToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Accepteert alleen tokens in het generator-formaat (32 lowercase hex). */
export function isValidReportToken(token: string): boolean {
  return REPORT_TOKEN_PATTERN.test(token);
}

/**
 * Payload van de share-actie: `expires_at` is optioneel (`null` = nooit
 * verlopend). De publieke URL stelt de API-route samen (fase 5).
 */
export const reportTokenSchema = z.object({
  token: z.string().regex(REPORT_TOKEN_PATTERN),
  expires_at: z.string().datetime().nullable().optional(),
});
export type ReportToken = z.infer<typeof reportTokenSchema>;

export const reportShareInputSchema = z.object({
  expires_at: z.string().datetime().nullable().optional(),
});
export type ReportShareInput = z.infer<typeof reportShareInputSchema>;
