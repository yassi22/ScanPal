import type { CwvMetrics } from "@scanpal/shared";

/**
 * Features 41–45 — BrowserRunner interface (injectable, Playwright-default).
 * Workers importeren `defaultBrowserRunner` of een mock; tests passeren een
 * vi.fn()-runner (vergelijkbaar met `fetchPage` in `checks/types.ts`). De
 * Playwright-default staat hier niet geïmporteerd — een aparte factory in
 * `playwright-runner.ts` bouwt de echte runner op, zodat tests deze module
 * kunnen mocken zonder `playwright` te laden.
 */

export type BrowserRunResult =
  | { ok: true; metrics: CwvMetrics }
  | { ok: false; error: string };

/** Resultaat van een axe-run: ruwe axe `violations[]`-array (ongeformatteerd). */
export type AxeRunResult =
  | { ok: true; violations: unknown }
  | { ok: false; error: string };

export type BrowserRunner = {
  /** Draait één page-load en vangt CWV-metrics. */
  captureVitals(url: string): Promise<BrowserRunResult>;
  /** Draait axe-core op de pagina en retourneert de violations[]-array. */
  runAxe(url: string): Promise<AxeRunResult>;
};
