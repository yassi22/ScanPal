import { z } from "zod";
import type { Finding } from "./findings";
import { scanCategorySchema } from "./scan-progress";

export const categoryScoresSchema = z.object({
  http: z.number().int().min(0).max(100).nullable(),
  seo: z.number().int().min(0).max(100).nullable(),
  aeo: z.number().int().min(0).max(100).nullable(),
  github: z.number().int().min(0).max(100).nullable(),
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;

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
      (item) => item.category === category && !item.active,
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
 * pass, zelfde logica als de inline probe). De aggregator (plan 27) schrijft
 * deze als `scans.score` naast de per-categorie-scores.
 */
export function overallScoreFromFindings(findings: Finding[]): number {
  const relevant = findings.filter((item) => !item.active);
  if (relevant.length === 0) return 0;
  const passed = relevant.filter((item) => item.severity === "info").length;
  return Math.round((passed / relevant.length) * 100);
}