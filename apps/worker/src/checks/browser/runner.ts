import type { CwvMetrics, ConsoleCapture, ResponsiveCapture, RenderCompareCapture, StorageSnapshot, RuntimeDepsCapture, AuthFlowCapture, AuthCredentials } from "@scanpal/shared";

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

/** Resultaat van een browser-storage-capture (plan 70). */
export type StorageRunResult =
  | { ok: true; snapshot: StorageSnapshot }
  | { ok: false; error: string };

/** Resultaat van een runtime-deps-capture (plan 71 v2): window-globals per lib. */
export type ClientDepsRunResult =
  | { ok: true; capture: RuntimeDepsCapture }
  | { ok: false; error: string };

/** Resultaat van een auth-flow-capture (plan 77): observaties voor 7 sub-checks. */
export type AuthFlowRunResult =
  | { ok: true; capture: AuthFlowCapture }
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
  /** Leest localStorage/sessionStorage na page-load (plan 70, passief). */
  captureStorage(url: string): Promise<StorageRunResult>;
  /** Leest window-globals van bekende JS-libs na page-load (plan 71 v2, passief). */
  captureClientDeps(url: string): Promise<ClientDepsRunResult>;
  /**
   * Auth-flow-capture (plan 77): ontdekt login/signup/reset-formulieren en
   * voert de veilige actieve subset uit (reset-probe, begrensde login-burst,
   * zwak-wachtwoord-validatie, sessie-observatie, MFA-signaal) met het eigen
   * wegwerp-testaccount. Niet-destructief; raakt nooit een ander account.
   */
  captureAuthFlow(url: string, credentials: AuthCredentials): Promise<AuthFlowRunResult>;
};
