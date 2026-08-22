import { z } from "zod";

/**
 * Features 44 & 45 — Browser-runtime issue capture (category aeo).
 *
 * Feature 44 vangt console-errors + network-failures via Playwright's
 * `page.on('console')` en `page.on('requestfailed')` events. Feature 45
 * vergelijkt mobile- en desktop-viewports op horizontale overflow en
 * tap-target-grootte. Beide checks draaien in de browser-worker via de
 * injectable BrowserRunner.
 *
 * Besluiten:
 * - Console-messages worden gecategoriseerd op type (error/warning/info/log).
 *   Alleen error + failed-request tellen mee voor de status (fail ≥ 1,
 *   anders warn bij warnings, anders pass).
 * - Network-failures zijn requests met status ≥ 400 óf een netwerkfout.
 * - Responsive: horizontale overflow op mobile (375px) is een warn, op
 *   desktop een info-signaal. Tap-targets onder 24px-CSS-pixels zijn een warn.
 * - Samples worden gecapteerd op 10 per groep (evidence-grootte).
 */

export type ConsoleType = "error" | "warning" | "info" | "log" | "debug";

export type ConsoleEntry = {
  type: ConsoleType;
  text: string;
  /** URL waar de console-message vandaan kwam (location.origin + stack). */
  location?: string;
};

export type RequestFailure = {
  url: string;
  method: string;
  status: number | null;
  error?: string;
};

export type ConsoleCapture = {
  messages: ConsoleEntry[];
  failed_requests: RequestFailure[];
};

export const consoleEntrySchema = z.object({
  type: z.enum(["error", "warning", "info", "log", "debug"]),
  text: z.string(),
  location: z.string().optional(),
});

export const requestFailureSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().int().nullable(),
  error: z.string().optional(),
});

export const consoleCaptureSchema = z.object({
  messages: z.array(consoleEntrySchema),
  failed_requests: z.array(requestFailureSchema),
});

/** Parseren van ruwe Playwright-console-events naar ConsoleEntry[]. */
export function parseConsoleMessages(raw: unknown): ConsoleEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: ConsoleEntry[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const row = m as { type?: unknown; text?: unknown; location?: unknown };
    if (typeof row.text !== "string") continue;
    const type = normalizeConsoleType(row.type);
    result.push({
      type,
      text: row.text,
      ...(typeof row.location === "string" && row.location.length > 0
        ? { location: row.location }
        : {}),
    });
  }
  return result;
}

function normalizeConsoleType(t: unknown): ConsoleType {
  if (typeof t !== "string") return "log";
  const v = t.toLowerCase();
  if (v === "error") return "error";
  if (v === "warning" || v === "warn") return "warning";
  if (v === "info") return "info";
  if (v === "debug") return "debug";
  return "log";
}

/** Parseren van ruwe Playwright requestfailed/response-events naar RequestFailure[]. */
export function parseRequestFailures(raw: unknown): RequestFailure[] {
  if (!Array.isArray(raw)) return [];
  const result: RequestFailure[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as { url?: unknown; method?: unknown; status?: unknown; error?: unknown };
    if (typeof row.url !== "string") continue;
    result.push({
      url: row.url,
      method: typeof row.method === "string" ? row.method : "GET",
      status: typeof row.status === "number" && Number.isFinite(row.status) ? Math.round(row.status) : null,
      ...(typeof row.error === "string" && row.error.length > 0 ? { error: row.error } : {}),
    });
  }
  return result;
}

export type ConsoleEvidence = {
  kind: "console-errors";
  total: number;
  by_type: { error: number; warning: number; info: number; log: number; debug: number };
  failed_requests: number;
  samples: { type: ConsoleType; text: string; location?: string }[];
  request_failures: { url: string; method: string; status: number | null; error?: string }[];
};

export const consoleEvidenceSchema = z.object({
  kind: z.literal("console-errors"),
  total: z.number().int(),
  by_type: z.object({
    error: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
    log: z.number().int(),
    debug: z.number().int(),
  }),
  failed_requests: z.number().int(),
  samples: z.array(
    z.object({
      type: z.enum(["error", "warning", "info", "log", "debug"]),
      text: z.string(),
      location: z.string().optional(),
    }),
  ),
  request_failures: z.array(
    z.object({
      url: z.string(),
      method: z.string(),
      status: z.number().int().nullable(),
      error: z.string().optional(),
    }),
  ),
});

export function consoleEvidence(capture: ConsoleCapture): ConsoleEvidence {
  const by = { error: 0, warning: 0, info: 0, log: 0, debug: 0 };
  for (const m of capture.messages) by[m.type] += 1;
  const errorOrWarning = capture.messages.filter(
    (m) => m.type === "error" || m.type === "warning",
  );
  return {
    kind: "console-errors",
    total: capture.messages.length,
    by_type: by,
    failed_requests: capture.failed_requests.length,
    samples: errorOrWarning.slice(0, 10).map((m) => ({
      type: m.type,
      text: m.text,
      ...(m.location ? { location: m.location } : {}),
    })),
    request_failures: capture.failed_requests.slice(0, 10).map((r) => ({
      url: r.url,
      method: r.method,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
}

/**
 * Overall-status: fail bij console-errors, netwerkfouten (status === null) of
 * 5xx-server-fouten. 4xx-client-fouten (zoals een missende favicon) zijn een
 * warn, geen fail — anders faalt deze check op vrijwel élke site. warn bij
 * warnings of 4xx, anders pass.
 */
export function consoleOverallStatus(capture: ConsoleCapture): "pass" | "warn" | "fail" {
  if (capture.messages.some((m) => m.type === "error")) return "fail";
  const hasNetworkFailure = capture.failed_requests.some(
    (r) => r.status === null || (r.status !== null && r.status >= 500),
  );
  if (hasNetworkFailure) return "fail";
  const hasClientError = capture.failed_requests.some(
    (r) => r.status !== null && r.status >= 400 && r.status < 500,
  );
  if (capture.messages.some((m) => m.type === "warning") || hasClientError) return "warn";
  return "pass";
}

// --- Feature 45: Mobile / responsive ---

export type ViewportIssues = {
  width: number;
  height: number;
  horizontal_scroll: boolean;
  overflow_px: number;
};

export type TapTargetIssue = {
  selector: string;
  width_px: number;
  height_px: number;
};

export type ResponsiveCapture = {
  mobile: ViewportIssues;
  desktop: ViewportIssues;
  tap_target_issues: TapTargetIssue[];
};

export const viewportIssuesSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  horizontal_scroll: z.boolean(),
  overflow_px: z.number(),
});

export const tapTargetIssueSchema = z.object({
  selector: z.string(),
  width_px: z.number(),
  height_px: z.number(),
});

export const responsiveCaptureSchema = z.object({
  mobile: viewportIssuesSchema,
  desktop: viewportIssuesSchema,
  tap_target_issues: z.array(tapTargetIssueSchema),
});

export type ResponsiveEvidence = {
  kind: "mobile-responsive";
  mobile: ViewportIssues;
  desktop: ViewportIssues;
  tap_target_issues: number;
  issues: string[];
  samples: TapTargetIssue[];
};

export const responsiveEvidenceSchema = z.object({
  kind: z.literal("mobile-responsive"),
  mobile: viewportIssuesSchema,
  desktop: viewportIssuesSchema,
  tap_target_issues: z.number().int(),
  issues: z.array(z.string()),
  samples: z.array(tapTargetIssueSchema),
});

/** Minimum tap-target-grootte (WCAG 2.5.5, 24×24 CSS-pixels). */
const MIN_TAP_TARGET_PX = 24;

/** Parseren van ruwe viewport-data naar ViewportIssues. */
export function parseViewportIssues(raw: unknown): ViewportIssues | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { width?: unknown; height?: unknown; horizontal_scroll?: unknown; overflow_px?: unknown };
  const width = typeof row.width === "number" ? Math.round(row.width) : 0;
  const height = typeof row.height === "number" ? Math.round(row.height) : 0;
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    horizontal_scroll: Boolean(row.horizontal_scroll),
    overflow_px:
      typeof row.overflow_px === "number" && Number.isFinite(row.overflow_px)
        ? Math.round(row.overflow_px)
        : 0,
  };
}

export function parseTapTargetIssues(raw: unknown): TapTargetIssue[] {
  if (!Array.isArray(raw)) return [];
  const result: TapTargetIssue[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as { selector?: unknown; width_px?: unknown; height_px?: unknown };
    if (typeof row.selector !== "string") continue;
    const width = typeof row.width_px === "number" ? row.width_px : 0;
    const height = typeof row.height_px === "number" ? row.height_px : 0;
    if (width <= 0 || height <= 0) continue;
    if (width >= MIN_TAP_TARGET_PX && height >= MIN_TAP_TARGET_PX) continue;
    result.push({ selector: row.selector, width_px: width, height_px: height });
  }
  return result.slice(0, 20);
}

export function responsiveEvidence(capture: ResponsiveCapture): ResponsiveEvidence {
  const issues: string[] = [];
  if (capture.mobile.horizontal_scroll) {
    issues.push(
      `Horizontale scroll op mobile (${capture.mobile.width}px, overflow=${capture.mobile.overflow_px}px)`,
    );
  }
  if (capture.desktop.horizontal_scroll) {
    issues.push(
      `Horizontale scroll op desktop (${capture.desktop.width}px, overflow=${capture.desktop.overflow_px}px)`,
    );
  }
  if (capture.tap_target_issues.length > 0) {
    issues.push(
      `${capture.tap_target_issues.length} tap-target(s) kleiner dan ${MIN_TAP_TARGET_PX}px`,
    );
  }
  return {
    kind: "mobile-responsive",
    mobile: capture.mobile,
    desktop: capture.desktop,
    tap_target_issues: capture.tap_target_issues.length,
    issues,
    samples: capture.tap_target_issues.slice(0, 10),
  };
}

/**
 * Overall-status: fail bij horizontale scroll op mobile (de core van de check),
 * warn bij tap-target-issues of desktop-overflow, anders pass.
 */
export function responsiveOverallStatus(capture: ResponsiveCapture): "pass" | "warn" | "fail" {
  if (capture.mobile.horizontal_scroll && capture.mobile.overflow_px > 8) return "fail";
  if (capture.tap_target_issues.length > 0) return "warn";
  if (capture.desktop.horizontal_scroll) return "warn";
  return "pass";
}
