import "server-only";

import { pool } from "./db";
import {
  ensureUserTeam,
  getOrCreateUserTeam,
  getUserTeam,
  completeOnboarding,
} from "./team-core";

export { ensureUserTeam, getOrCreateUserTeam, getUserTeam, completeOnboarding };

export type { AuthUser, TeamResult } from "./team-core";

export const db = pool;
