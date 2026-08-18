import { z } from "zod";
import { detectGithubRepoFromUrl } from "./sites";

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

export const onboardingSiteInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "URL is verplicht")
      .refine((v) => /^https?:\/\//i.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(v), {
        message: "Voer een geldige URL in, bijvoorbeeld https://voorbeeld.nl",
      }),
  })
  .superRefine((value, ctx) => {
    const detected = detectGithubRepoFromUrl(value.url);
    if (detected) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: `GitHub-repo herkend als ${detected} — vul ook een website-URL in`,
      });
    }
  });
export type OnboardingSiteInput = z.infer<typeof onboardingSiteInputSchema>;

export const magicLinkInputSchema = z.object({
  email: z.string().trim().email("Voer een geldig e-mailadres in"),
});
export type MagicLinkInput = z.infer<typeof magicLinkInputSchema>;

export const inviteInputSchema = z.object({
  email: z.string().trim().email("Voer een geldig e-mailadres in"),
  role: userRoleSchema.optional().default("member"),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;

export const invitationSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  email: z.string().email(),
  role: userRoleSchema,
  token: z.string(),
  expires_at: z.string().datetime(),
  accepted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const teamMemberSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().email(),
  role: userRoleSchema,
  status: membershipStatusSchema,
  created_at: z.string().datetime(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const roleChangeSchema = z.object({
  role: userRoleSchema,
});
export type RoleChange = z.infer<typeof roleChangeSchema>;

export * from "./plans";
export * from "./api-keys";
export * from "./active-tests";
export * from "./bundle-secrets";
export * from "./severity";
export * from "./sites";
export * from "./scans";
export * from "./schedule";
export * from "./scan-progress";
export * from "./scan-progress-math";
export * from "./check-catalog";
export * from "./findings";
export * from "./uptime";
export * from "./threats";
export * from "./notifications";
export * from "./webhooks";
export * from "./billing";
export * from "./scoring";
export * from "./report";
export * from "./routes";
export * from "./aeo-engine-matrix";
export * from "./domain";
export * from "./public-status";
export * from "./deploy-webhooks";
export * from "./diff";
export * from "./fix-prompt";
export * from "./compliance";
export * from "./meta-tags";
export * from "./stack-detection";
export * from "./redirects-mixed";
export * from "./subresources";
export * from "./structured-data";
export * from "./security-txt";
export * from "./secrets-in-html";
export * from "./mini-crawl";
export * from "./repo-health";
export * from "./sast-findings";
export * from "./browser-vitals";
