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
  /**
   * Aantal routes dat de http-scan-worker binnen één scan tegelijk verwerkt
   * (elke route wordt één keer opgehaald en gedeeld over zijn checks). Hoger =
   * snellere scan, maar meer gelijktijdige requests naar de doel-site; houd het
   * beleefd (aanrader ≤ 8). Default 4.
   */
  PROBE_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
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