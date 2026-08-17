import { z } from "zod";

/**
 * Publieke statuspagina (plan 57). Publiek deelbare uptime-status per site —
 * bewust ALLEEN uptime-data: status, uptime-%, 30/90-dagen-dagbalken en
 * incidenten. Geen findings, scores, team-internals of PII. Deelbaar als
 * `/status/[slug]`-URL en als JSON-feed voor badges/embedding.
 */

/** Dagbalk voor de 30/90-dagen-grafiek: up = alle checks ok, down = ≥1
 *  mislukte check, nodata = geen checks die dag (geen meting). */
export const publicStatusDaySchema = z.object({
  /** YYYY-MM-DD (UTC). */
  day: z.string(),
  status: z.enum(["up", "down", "nodata"]),
});
export type PublicStatusDay = z.infer<typeof publicStatusDaySchema>;

export const publicStatusIncidentSchema = z.object({
  start: z.string().datetime(),
  /** null = incident loopt nog. */
  end: z.string().datetime().nullable(),
  /** Publieke classificatie van de down-oorzaak (uit de probe-error). */
  error_class: z.string().nullable(),
});
export type PublicStatusIncident = z.infer<typeof publicStatusIncidentSchema>;

/**
 * Contract van `/api/public/status/[slug]` + de SSR-pagina. `series` is de
 * dagbalk-serie voor het gevraagde venster (`?days=30|90`, default 30) —
 * toegevoegd aan het plan-contract omdat de grafiek deze client-side nodig
 * heeft; `uptime_30d`/`uptime_90d` zijn altijd beide aanwezig.
 */
export const publicStatusSchema = z.object({
  site_host: z.string(),
  status: z.enum(["up", "down", "unknown"]),
  uptime_30d: z.number().min(0).max(100).nullable(),
  uptime_90d: z.number().min(0).max(100).nullable(),
  series: z.array(publicStatusDaySchema),
  incidents: z.array(publicStatusIncidentSchema),
});
export type PublicStatus = z.infer<typeof publicStatusSchema>;

/** Aantal tekens van de gegenereerde slug (12+, URL-safe). */
export const PUBLIC_STATUS_SLUG_LENGTH = 16;

/**
 * Genereert een niet-rabare slug: `crypto.randomUUID()`-derivaat, 16 hex-
 * tekens (64 bits entropie), URL-safe en lowercase. Opt-in per site.
 */
export function generatePublicStatusSlug(): string {
  return crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, PUBLIC_STATUS_SLUG_LENGTH);
}

/** Accepteert alleen slugs in het generator-formaat (hex, 12–32 tekens). */
export function isValidPublicStatusSlug(value: string): boolean {
  return /^[0-9a-f]{12,32}$/.test(value);
}

/** Bekende probe-error-codes uit `apps/worker/src/uptime/probe.ts`. */
const KNOWN_ERROR_CLASSES = new Set([
  "timeout",
  "dns",
  "tls",
  "connect",
  "network",
  "http-5xx",
  "too-many-redirects",
  "invalid-url",
]);

/**
 * Vertaalt de opgeslagen probe-error naar een publieke klasse. Bekende
 * codes worden doorgegeven, onbekende (bv. foutmeldingen met details) worden
 * afgevlakt naar `other` zodat de publieke feed nooit interne details lekt.
 */
export function publicErrorClass(error: string | null): string | null {
  if (!error) return null;
  return KNOWN_ERROR_CLASSES.has(error) ? error : "other";
}