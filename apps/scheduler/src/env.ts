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
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().default("ScanPal <no-reply@scanpal.dev>"),
  APP_URL: z.url().optional().default("http://localhost:3000"),
  /** 32-byte base64 AES-GCM-sleutel voor webhook-secrets (plan 15). */
  WEBHOOK_SECRET_KEY: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Ongeldige scheduler-omgeving: ${parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ")}`,
  );
}

export const env = parsed.data;