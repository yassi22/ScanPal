import { checkById, checksForCategory } from "./check-catalog";
import { findingsPayloadSchema } from "./findings";
import { scanCategories } from "./check-catalog";
import type { ScanCategory } from "./scan-progress";
import type { CategoryProgress, ProgressDetails, SeverityCounts } from "./scan-progress";

/**
 * Pure progress-math (plan 27, besluit 3): geen DB, geen server-only — de
 * webapp en de workers delen deze ene bron. `scan-progress.ts` houdt alleen de
 * schemas; de reken-helpers wonen hier om een import-cyclus
 * (scan-progress ↔ check-catalog/findings) te voorkomen.
 */

/**
 * Progress-skelet voor een scan. `totals` = aantal checks per categorie dat
 * deze run gaat draaien (de dispatcher berekent ze uit de catalog per
 * queue-owner); categorieën zonder checks blijven op 0 (UI toont "—").
 */
export function initialProgressDetails(
  totals: Partial<Record<ScanCategory, number>> = {},
  now: string = new Date().toISOString(),
): ProgressDetails {
  const categories = {} as Record<ScanCategory, CategoryProgress>;
  let checksTotal = 0;
  for (const category of scanCategories) {
    const total = Math.max(0, Math.floor(totals[category] ?? 0));
    checksTotal += total;
    categories[category] = {
      status: "pending",
      done: 0,
      total,
      percent: 0,
      current_check: null,
    };
  }
  return {
    categories,
    checks_done: 0,
    checks_total: checksTotal,
    updated_at: now,
  };
}

/**
 * Schuift de voortgang één check op (idempotent: onbekende check-ids of
 * al-voltooide categorieën laten de stand onveranderd). In queue-modus
 * (plan 27, besluit 4) is `current_check` de zojuist voltooide check — checks
 * draaien parallel, er is geen "volgende in catalogus-volgorde".
 */
export function advanceProgressDetails(
  current: ProgressDetails,
  completedCheckId: string,
  now: string,
): ProgressDetails {
  const entry = checkById(completedCheckId);
  if (!entry) return current;
  const cat = current.categories[entry.category];
  if (!cat || cat.status === "done" || cat.done >= cat.total) return current;

  const done = cat.done + 1;
  const isDone = done >= cat.total;

  const categories: Record<ScanCategory, CategoryProgress | undefined> = {
    ...current.categories,
    [entry.category]: {
      status: isDone ? "done" : "running",
      done,
      total: cat.total,
      percent: cat.total > 0 ? Math.round((done / cat.total) * 100) : 100,
      current_check: isDone ? null : entry.name,
    },
  };

  return {
    categories,
    checks_done: Math.min(current.checks_done + 1, current.checks_total),
    checks_total: current.checks_total,
    updated_at: now,
  };
}

export function overallProgress(details: ProgressDetails): number {
  if (details.checks_total === 0) return 0;
  return Math.round((details.checks_done / details.checks_total) * 100);
}

/**
 * Severity-verdeling uit findings, voor het `completed`-event en de
 * resultaten-header. Leest het versioned findings-payload (plan 09);
 * legacy-data (`{ checks: [...] }`) en lege payloads leveren nullen op.
 * Actieve-test-findings (plan 52) tellen hier NIET mee.
 */
export function summarizeFindings(
  findings: Record<string, unknown>,
): SeverityCounts {
  const summary: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const parsed = findingsPayloadSchema.safeParse(findings);
  if (!parsed.success) return summary;
  for (const item of parsed.data.items) {
    if (item.active) continue;
    summary[item.severity] += 1;
  }
  return summary;
}

/** Check-ids per categorie, in catalogus-volgorde (worker-run-ordre). */
export function checksForCategoryInOrder(category: ScanCategory): string[] {
  return checksForCategory(category).map((entry) => entry.id);
}