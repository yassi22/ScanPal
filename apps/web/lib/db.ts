import "server-only";

import { Pool } from "pg";
import { env } from "./env";

const usesSupabase = env.databaseUrl.includes("supabase.co");

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: usesSupabase ? { rejectUnauthorized: false } : undefined,
  max: 10,
});
