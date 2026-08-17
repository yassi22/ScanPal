import "server-only";

import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  DATABASE_URL: z.string().min(10),
  REDIS_URL: z.string().min(5).optional().default("redis://localhost:6379"),
  APP_URL: z.url().optional().default("http://localhost:3000"),
  HONEYPOT_BASE_URL: z.url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().default("ScanPal <no-reply@scanpal.dev>"),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  /** Jaarplan (plan 16): prijs-ID van het jaarlijkse Pro-abonnement. */
  STRIPE_PRICE_PRO_ANNUAL: z.string().min(1).optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  /** 32-byte base64 AES-GCM-sleutel voor outbound webhook-secrets (plan 15). */
  WEBHOOK_SECRET_KEY: z.string().min(1).optional(),
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
  redisUrl: raw.REDIS_URL,
  appUrl: raw.APP_URL,
  honeypotBaseUrl: raw.HONEYPOT_BASE_URL,
  resendApiKey: raw.RESEND_API_KEY,
  resendFrom: raw.RESEND_FROM,
  stripeSecretKey: raw.STRIPE_SECRET_KEY,
  stripeWebhookSecret: raw.STRIPE_WEBHOOK_SECRET,
  stripePricePro: raw.STRIPE_PRICE_PRO,
  stripePriceProAnnual: raw.STRIPE_PRICE_PRO_ANNUAL,
  stripePublishableKey: raw.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  webhookSecretKey: raw.WEBHOOK_SECRET_KEY,
};

