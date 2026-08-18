import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webEnvPath = path.join(__dirname, "..", "..", "web", ".env");

loadEnv({ path: webEnvPath });

const envSchema = z.object({
  DATABASE_URL: z.string().min(10),
  REDIS_URL: z.string().min(5).default("redis://localhost:6379"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  MAINTENANCE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 60 * 60 * 1000),
  PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  PROBE_MAX_CONCURRENCY: z.coerce.number().int().positive().default(10),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().default("ScanPal <no-reply@scanpal.dev>"),
  APP_URL: z.url().optional().default("http://localhost:3000"),
  /** Plan 62: CrUX-API-key (Google, gratis). Zonder key → geen field data. */
  CRUX_API_KEY: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Ongeldige worker-omgeving: ${parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ")}`,
  );
}

export const env = parsed.data;