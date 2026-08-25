import { z } from "zod";

export const OWNERSHIP_METHOD = "dns-txt" as const;
export const OWNERSHIP_VERIFICATION_VALID_DAYS = 30;
export const OWNERSHIP_TXT_PREFIX = "scanpal-verify";

export const ownershipVerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "expired",
]);
export type OwnershipVerificationStatus = z.infer<
  typeof ownershipVerificationStatusSchema
>;

export const ownershipSchema = z.object({
  token: z.string().min(32).max(128),
  record_name: z.string().min(1),
  record_value: z.string().min(1),
  verified_at: z.string().datetime().nullable(),
});
export type Ownership = z.infer<typeof ownershipSchema>;

export const ownershipCheckReasonSchema = z.enum([
  "record-not-found",
  "dns-lookup-failed",
  "token-missing",
  "invalid-site-url",
  "site-not-found",
  "token-rotated",
]);
export type OwnershipCheckReason = z.infer<typeof ownershipCheckReasonSchema>;

export const ownershipVerificationResponseSchema = z.discriminatedUnion(
  "verified",
  [
    z.object({
      verified: z.literal(true),
      verified_at: z.string().datetime(),
    }),
    z.object({
      verified: z.literal(false),
      reason: ownershipCheckReasonSchema,
    }),
  ],
);
export type OwnershipVerificationResponse = z.infer<
  typeof ownershipVerificationResponseSchema
>;

export function ownershipRecordValue(token: string): string {
  return `${OWNERSHIP_TXT_PREFIX}=${token}`;
}

function stripPresentationQuotes(value: string): string {
  let result = value.trim();
  while (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

export function matchesOwnershipTxt(
  records: ReadonlyArray<string | ReadonlyArray<string>>,
  token: string,
): boolean {
  if (!token) return false;

  return records.some((record) => {
    const joined = typeof record === "string" ? record : record.join("");
    const normalized = stripPresentationQuotes(joined);
    const match = normalized.match(/^scanpal-verify\s*=\s*(\S+)$/i);
    return match !== null && stripPresentationQuotes(match[1]) === token;
  });
}

export function ownershipVerificationStatus(
  verifiedAt: string | Date | null,
  now: Date = new Date(),
  validDays: number = OWNERSHIP_VERIFICATION_VALID_DAYS,
): OwnershipVerificationStatus {
  if (!verifiedAt) return "unverified";
  const timestamp = new Date(verifiedAt).getTime();
  if (!Number.isFinite(timestamp)) return "unverified";
  return now.getTime() - timestamp > validDays * 86_400_000
    ? "expired"
    : "verified";
}
