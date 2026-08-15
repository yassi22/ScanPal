import { z } from "zod";

export const userRoleSchema = z.enum(["owner", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const membershipStatusSchema = z.enum(["pending", "accepted"]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  auth_provider: z.string().nullable(),
  last_login_at: z.string().datetime().nullable(),
  onboarding_completed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const teamSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string().datetime(),
});
export type Team = z.infer<typeof teamSchema>;

export const membershipSchema = z.object({
  team_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: userRoleSchema,
  status: membershipStatusSchema,
  created_at: z.string().datetime(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const meResponseSchema = z.object({
  user: userProfileSchema,
  team: teamSchema,
  membership: membershipSchema,
  onboarding_completed: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const siteSchema = z.object({
  id: z.uuid(),
  team_id: z.uuid(),
  url: z.url(),
  created_at: z.string().datetime(),
});
export type Site = z.infer<typeof siteSchema>;

export const scanStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const scanSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  status: scanStatusSchema,
  progress: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100).nullable(),
  findings: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type Scan = z.infer<typeof scanSchema>;

export const onboardingSiteInputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is verplicht")
    .refine((v) => /^https?:\/\//i.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(v), {
      message: "Voer een geldige URL in, bijvoorbeeld https://voorbeeld.nl",
    }),
});
export type OnboardingSiteInput = z.infer<typeof onboardingSiteInputSchema>;

export const magicLinkInputSchema = z.object({
  email: z.string().trim().email("Voer een geldig e-mailadres in"),
});
export type MagicLinkInput = z.infer<typeof magicLinkInputSchema>;
