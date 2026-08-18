import type { CwvMetrics, ConsoleCapture, ResponsiveCapture, RenderCompareCapture } from "@scanpal/shared";

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

/** Resultaat van een console/network-capture (feature 44). */
export type ConsoleRunResult =
  | { ok: true; capture: ConsoleCapture }
  | { ok: false; error: string };

/** Resultaat van een responsive-capture (feature 45). */
export type ResponsiveRunResult =
  | { ok: true; capture: ResponsiveCapture }
  | { ok: false; error: string };

/** Resultaat van een server-vs-rendered-DOM vergelijking (feature 43). */
export type RenderRunResult =
  | { ok: true; capture: RenderCompareCapture }
  | { ok: false; error: string };

export type BrowserRunner = {
  /** Draait één page-load en vangt CWV-metrics. */
  captureVitals(url: string): Promise<BrowserRunResult>;
  /** Draait axe-core op de pagina en retourneert de violations[]-array. */
  runAxe(url: string): Promise<AxeRunResult>;
  /** Vangt console-messages en failed-requests op (feature 44). */
  captureConsole(url: string): Promise<ConsoleRunResult>;
  /** Vangt mobile/desktop-viewport-issues + tap-target-issues (feature 45). */
  captureResponsive(url: string): Promise<ResponsiveRunResult>;
  /** Vergelijkt server-HTML (zonder JS) met de gerenderde DOM (feature 43). */
  captureRenderCompare(url: string): Promise<RenderRunResult>;
};
