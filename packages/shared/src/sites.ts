import { z } from "zod";

/**
 * Canonieke vorm van een site-URL: protocol + www weggestript, hostname
 * lowercase, trailing slash weg, niet-standaard poort behouden.
 * Varianten als https://www.voorbeeld.nl en http://voorbeeld.nl worden één url.
 * Geeft null terug voor ongeldige input.
 */
export function canonicalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || !host.includes(".")) return null;

  const tld = host.split(".").pop() ?? "";
  if (tld.length < 2 || !/[a-z]/i.test(tld)) return null;

  const bare = host.startsWith("www.") ? host.slice(4) : host;
  const port =
    parsed.port && parsed.port !== "80" && parsed.port !== "443"
      ? `:${parsed.port}`
      : "";
  const path = parsed.pathname.replace(/\/+$/, "");

  return `${bare}${port}${path}${parsed.search}`;
}

/**
 * Canonieke vorm van een GitHub-repo: owner/repo, lowercase.
 * Accepteert ook github.com-links (https://github.com/owner/repo of
 * github.com/owner/repo) en een trailing `.git`. Geeft null terug voor
 * ongeldige input (andere domeinen, subpaden, verboden tekens).
 */
export function canonicalizeGithubRepo(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let value = trimmed;
  const ghUrl = value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (ghUrl) {
    value = ghUrl[1];
  } else if (/^[a-z]+:\/\//i.test(value)) {
    return null;
  }

  value = value.replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value)) return null;
  // Geen pad-traversal: `..`-segmenten zouden de URL buiten de repo laten
  // ontsnappen (bijv. `/repos/../user` → `/user` op de GitHub-API).
  if (/(^|\/)\.\.(\/|$)/.test(value)) return null;

  return value.toLowerCase();
}

/**
 * Herkent een GitHub-repo in een url-veld (feature 18): een github.com-link
 * (met/zonder protocol, www, trailing `.git`; subpaden afgewezen) of een losse
 * `owner/repo`-string die géén geldige website-URL is. Retourneert de canonieke
 * `owner/repo`-vorm, anders null.
 */
export function detectGithubRepoFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(trimmed)) {
    return canonicalizeGithubRepo(trimmed);
  }

  if (canonicalizeSiteUrl(trimmed) !== null) return null;
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(trimmed)) return null;

  return canonicalizeGithubRepo(trimmed);
}

export const siteUrlSchema = z.string().trim().min(1);

export const siteSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  url: siteUrlSchema,
  created_at: z.string().datetime(),
});
export type Site = z.infer<typeof siteSchema>;

export const siteStatusSchema = z.enum(["up", "down", "unknown"]);
export type SiteStatus = z.infer<typeof siteStatusSchema>;

export const scanStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const addSiteInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "URL is verplicht")
      .refine((v) => canonicalizeSiteUrl(v) !== null, {
        message: "Voer een geldige URL in, bijvoorbeeld https://voorbeeld.nl",
      }),
    github_repo: z
      .string()
      .trim()
      .max(200, "GitHub-repo is maximaal 200 tekens")
      .refine((v) => v === "" || canonicalizeGithubRepo(v) !== null, {
        message:
          "Ongeldig GitHub-repo — gebruik owner/repo of een github.com-link",
      })
      .optional(),
    label: z
      .string()
      .trim()
      .max(100, "Label is maximaal 100 tekens")
      .optional(),
    workspace_id: z.string().uuid().nullable().optional(),
    reuse: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const detected = detectGithubRepoFromUrl(value.url);
    if (detected) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: `GitHub-repo herkend als ${detected} — vul ook een website-URL in`,
      });
    }
  });
export type AddSiteInput = z.infer<typeof addSiteInputSchema>;

export const updateSiteInputSchema = z
  .object({
    label: z
      .string()
      .trim()
      .max(100, "Label is maximaal 100 tekens")
      .nullable()
      .optional(),
    github_repo: z
      .string()
      .trim()
      .max(200, "GitHub-repo is maximaal 200 tekens")
      .refine((v) => v === "" || canonicalizeGithubRepo(v) !== null, {
        message:
          "Ongeldig GitHub-repo — gebruik owner/repo of een github.com-link",
      })
      .nullable()
      .optional(),
    /** Plan 57: publieke statuspagina aan/uit — slug genereren/verwijderen. */
    public_status: z.object({ enabled: z.boolean() }).optional(),
    workspace_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.label === undefined &&
      value.github_repo === undefined &&
      value.public_status === undefined &&
      value.workspace_id === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Geef minimaal één veld om te wijzigen",
      });
    }
  });
export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;

export const siteWithStatusSchema = siteSchema.extend({
  workspace_id: z.string().uuid().nullable().optional(),
  github_repo: z.string().nullable(),
  label: z.string().nullable(),
  /** Plan 57: niet-rabare publieke status-slug (null = niet publiek). */
  public_status_slug: z.string().nullable(),
  /** Plan 58: on-deploy-webhook geconfigureerd (secret aanwezig, nooit het secret zelf). */
  github_webhook_configured: z.boolean(),
  last_scan_id: z.string().uuid().nullable(),
  last_scan_status: scanStatusSchema.nullable(),
  last_scan_score: z.number().int().min(0).max(100).nullable(),
  last_scanned_at: z.string().datetime().nullable(),
  uptime_state: siteStatusSchema,
  scan_frequency: z.enum(["none", "daily", "weekly"]),
  next_scan_at: z.string().datetime().nullable(),
});
export type SiteWithStatus = z.infer<typeof siteWithStatusSchema>;

export const siteListResponseSchema = z.object({
  sites: z.array(siteWithStatusSchema),
});
