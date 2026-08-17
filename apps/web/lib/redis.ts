import "server-only";

import { Redis } from "ioredis";
import { env } from "./env";

/**
 * Gedeelde Redis-client (rate limiting, plan 14/feature 26). `lazyConnect` +
 * `enableOfflineQueue: false` zodat een draaiende app zonder Redis geen
 * oneindige wachtrij opbouwt — commands falen direct.
 */
export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});

export async function closeRedis(): Promise<void> {
  if (redis.status === "end" || redis.status === "close") return;
  await redis.quit();
}
