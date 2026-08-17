import { randomUUID } from "node:crypto";

/**
 * Minimal Redis surface voor locks (SET NX EX + eval). `ioredis` voldoet
 * hieraan; in tests een in-memory fake.
 */
export type LockClient = {
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    nx: "NX",
  ): Promise<"OK" | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
};

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export async function acquireLock(
  redis: LockClient,
  key: string,
  ttlSeconds: number,
): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(key, token, "EX", ttlSeconds, "NX");
  return result === "OK" ? token : null;
}

export async function releaseLock(
  redis: LockClient,
  key: string,
  token: string,
): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, key, token);
}
