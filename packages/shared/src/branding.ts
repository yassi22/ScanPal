import { z } from "zod";

/**
 * Team-branding (plan 64): witte-label-uitslag van rapporten en publieke
 * pagina's. Alle velden zijn optioneel zodat `{}` (de DB-default) valideert;
 * `null` = "niet gezet", `undefined` = "ongewijzigd bij patch".
 */
export const brandingSchema = z.object({
  /** Absolute HTTPS-URL van het teamlogo (geen http/javascript/data: i.v.m. SSRF/XSS). */
  logo_url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), { message: "logo_url moet een https:// URL zijn" })
    .nullable()
    .optional(),
  /** Accentkleur als 6-cijferige hex (`#RRGGBB`). */
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  /** Eigen naam van het rapport/de statuspagina i.p.v. "ScanPal". */
  report_name: z.string().trim().max(120).nullable().optional(),
  /** Verberg de ScanPal-branding volledig (default: zichtbaar). */
  hide_branding: z.boolean().default(false),
});
export type Branding = z.infer<typeof brandingSchema>;
