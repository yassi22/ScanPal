import "server-only";

import { pool } from "./db";
import {
  ensureUserTeam,
  completeOnboarding,
} from "./team-core";

export { ensureUserTeam, completeOnboarding };

export type { AuthUser, TeamResult } from "./team-core";

export const db = pool;
