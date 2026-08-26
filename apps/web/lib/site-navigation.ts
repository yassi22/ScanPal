import { z } from "zod";

const siteIdSchema = z.string().uuid();

export function isSiteId(value: string): boolean {
  return siteIdSchema.safeParse(value).success;
}

export function toAbsoluteSiteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
