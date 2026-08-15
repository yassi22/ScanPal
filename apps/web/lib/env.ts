import "server-only";

import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  DATABASE_URL: z.string().min(10),
  APP_URL: z.url().optional().default("http://localhost:3000"),
  SCAN_MODE: z.enum(["inline", "queue"]).optional().default("inline"),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().default("ScanPal <no-reply@scanpal.dev>"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Ongeldige omgeving: ${parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ")} (zie apps/web/.env.example)`,
  );
}

const raw = parsed.data;

export const env = {
  supabaseUrl: raw.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: raw.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY,
  databaseUrl: raw.DATABASE_URL,
  appUrl: raw.APP_URL,
  scanMode: raw.SCAN_MODE,
  resendApiKey: raw.RESEND_API_KEY,
  resendFrom: raw.RESEND_FROM,
};

