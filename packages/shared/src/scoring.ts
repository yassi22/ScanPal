import { z } from "zod";
import type { Finding } from "./findings";
import { scanCategorySchema } from "./scan-progress";

export const categoryScoresSchema = z.object({
  http: z.number().int().min(0).max(100).nullable(),
  seo: z.number().int().min(0).max(100).nullable(),
  aeo: z.number().int().min(0).max(100).nullable(),
  github: z.number().int().min(0).max(100).nullable(),
  // Plan 61: compliance-pijler. Default null zodat oude scans (zonder
  // compliance-scores) blijven valideren; nieuwe scans bevatten de sleutel.
  compliance: z.number().int().min(0).max(100).nullable().default(null),
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;

/**
 * Gewicht van de compliance-categorie in de overall-score (plan 61, besluit 5):
 * compliance is een "pijler" naast http/seo/aeo/github en telt met een
 * ondersteunend gewicht mee in het totaal.
 */
export const COMPLIANCE_WEIGHT = 0.1;

/**
 * Plan 79, besluit 3: `observability-signals` is uitdrukkelijk informatief en
 * mag geen score-straf opleveren (afwezigheid van client-side telemetrie
 * bewijst niets over server-side audit-logging). De `low`-severity op de
 * afwezigheids-tak zou anders wél als niet-pass meewegen in de pass-ratio —
 * daarom wordt dit check-id net als actieve-test-findings uitgesloten van
 * zowel de categorie- als de overall-score.
 */
export const SCORE_EXCLUDED_CHECK_IDS: ReadonlySet<string> = new Set([
  "observability-signals",
]);

/**
 * Pass-ratio per categorie: `info`-findings / totaal × 100 (zelfde logica als
 * de resultaten-UI, `CategoryScore` in scan-result.tsx). Actieve-test-findings
 * (plan 52) tellen niet mee; een categorie zonder checks is `null`
 * ("niet gescand"). Plan 08/27 slaat straks dezelfde output-vorm op in
 * `scans.category_scores` — deze helper is de enige bron zolang die kolom er
 * niet is.
 */
export function categoryScoresFromFindings(findings: Finding[]): CategoryScores {
  const scores = {} as CategoryScores;
  for (const category of scanCategorySchema.options) {
    const relevant = findings.filter(
      (item) =>
        item.category === category &&
        !item.active &&
        !SCORE_EXCLUDED_CHECK_IDS.has(item.check_id),
    );
    if (relevant.length === 0) {
      scores[category] = null;
      continue;
    }
    const passed = relevant.filter((item) => item.severity === "info").length;
    scores[category] = Math.round((passed / relevant.length) * 100);
  }
  return scores;
}

/**
 * Overall-score = pass-ratio over alle niet-actieve findings (info-severity =
 * pass, zelfde logica als de inline probe). Plan 61: compliance telt mee met
 * een ondersteunend gewicht (`COMPLIANCE_WEIGHT`, 10%) naast de overige
 * categorieën; zónder compliance-findings is de score ongewijzigd (rest-ratio).
 * De aggregator (plan 27) schrijft deze als `scans.score`.
 */
export function overallScoreFromFindings(findings: Finding[]): number {
  const relevant = findings.filter(
    (item) => !item.active && !SCORE_EXCLUDED_CHECK_IDS.has(item.check_id),
  );
  if (relevant.length === 0) return 0;
  const compliance = relevant.filter((item) => item.category === "compliance");
  const rest = relevant.filter((item) => item.category !== "compliance");

  const restScore = passRatio(rest);
  if (compliance.length === 0) return restScore;
  const complianceScore = passRatio(compliance);
  if (rest.length === 0) return complianceScore;
  return Math.round(
    restScore * (1 - COMPLIANCE_WEIGHT) + complianceScore * COMPLIANCE_WEIGHT,
  );
}

function passRatio(items: Finding[]): number {
  if (items.length === 0) return 0;
  const passed = items.filter((item) => item.severity === "info").length;
  return Math.round((passed / items.length) * 100);
}