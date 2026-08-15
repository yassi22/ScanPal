export const userRoles = ["owner", "member"] as const;
export const membershipStatuses = ["pending", "accepted"] as const;
export const scanStatuses = ["queued", "running", "completed", "failed"] as const;

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
  created_at: Date;
};

export type MembershipRow = {
  team_id: string;
  user_id: string;
  role: (typeof userRoles)[number];
  status: (typeof membershipStatuses)[number];
  invited_by: string | null;
  created_at: Date;
};

export type SiteRow = {
  id: string;
  team_id: string;
  url: string;
  created_at: Date;
};

export type ScanRow = {
  id: string;
  site_id: string;
  status: (typeof scanStatuses)[number];
  progress: number;
  score: number | null;
  findings: Record<string, unknown>;
  created_at: Date;
  completed_at: Date | null;
};
