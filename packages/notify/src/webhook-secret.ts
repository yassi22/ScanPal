import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Webhook-secrets at rest: AES-256-GCM met een 32-byte base64-key uit de
 * omgeving (`WEBHOOK_SECRET_KEY`, zelfde pattern als sites.github_webhook_secret
 * in plan 58). Opslagformaat: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * De plaintext is alleen bij creatie/rotatie 1× zichtbaar.
 */

const IV_LENGTH = 12;
const KEY_BYTES = 32;

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function encryptWebhookSecret(key: string, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptWebhookSecret(key: string, stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("onbekend secret-formaat");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(key),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function keyBytes(key: string): Buffer {
  return Buffer.from(key, "base64");
}

/** 32 random bytes → base64 → onze env-key; voor setup/tests. */
export function generateSecretKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
