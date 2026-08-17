import type { Redis } from "ioredis";

export const RATE_LIMIT_WINDOW_SECONDS = 60;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Redis fixed-window limiet (INCR + EXPIRE op eerste hit), zelfde patroon als
 * de webapp (lib/rate-limit.ts) maar met een eigen Redis-client voor de
 * worker-processen.
 */
export function createRateLimiter(redis: Redis) {
  return async function checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number = RATE_LIMIT_WINDOW_SECONDS,
  ): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    if (count > limit) {
      const ttl = await redis.ttl(redisKey);
      return { ok: false, retryAfterSeconds: Math.max(ttl, 1) };
    }
    return { ok: true };
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;