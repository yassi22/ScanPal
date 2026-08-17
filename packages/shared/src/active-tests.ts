import { z } from "zod";

/**
 * Opt-in input voor actieve vulnerability-tests (plan 52): alleen met
 * expliciete `active_tests: true` én Pro-plan draaien de actieve probes.
 */
export const activeTestsInputSchema = z.object({
  active_tests: z.boolean().optional().default(false),
});
export type ActiveTestsInput = z.infer<typeof activeTestsInputSchema>;

/**
 * Gestructureerd bewijs voor actieve-test-findings: het reproduceerbare
 * verzoek + de (afgekapte) response. Beide max ~4KB (evidenceMaxBytes).
 */
export const evidenceSchema = z.object({
  request: z.string(),
  response: z.string(),
});
export type FindingEvidence = z.infer<typeof evidenceSchema>;

export const ACTIVE_TEST_LIMITS = {
  /** Max aantal payloads per test (curated set, geen wordlist). */
  maxPayloadsPerTest: 3,
  /** Timeout per individueel probe-verzoek. */
  timeoutMs: 4000,
  /** Afkapgrens per evidence-veld (request én response). */
  evidenceMaxBytes: 4096,
  /** Max aantal probe-verzoeken per scan (veiligheidsgrens). */
  maxProbes: 12,
  /** Per-host Redis rate-limit (verplicht uit AGENTS.md). */
  probesPerHostPerMinute: 30,
} as const;

export function truncateEvidence(value: string): string {
  return value.length > ACTIVE_TEST_LIMITS.evidenceMaxBytes
    ? value.slice(0, ACTIVE_TEST_LIMITS.evidenceMaxBytes) + "…"
    : value;
}

/** Kleine curated SQLi-payloads — alleen als GET-parameter, dummy-waarden. */
export const SQLI_PAYLOADS = [
  "'",
  "' OR '1'='1",
  "1' OR '1'='1' --",
  "' UNION SELECT NULL--",
];

/** Reflected-XSS-payloads via GET-parameters. */
export const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "\"><svg/onload=alert(1)>",
];

export const SQL_ERROR_PATTERN =
  /SQL syntax|mysql_fetch|ORA-\d{5}|Unclosed quotation|PostgreSQL.*ERROR|SQLSTATE|syntax error|near "\w+" at line/i;

export const STACK_TRACE_PATTERN =
  /(stack trace|at .+\(.+\)|Traceback \(most recent call last\)|\.NET|java\.lang\.\w+Exception|Uncaught TypeError)/i;

/** Open-redirect-payloads — externe hosts, dummy-waarden. */
export const OPEN_REDIRECT_PAYLOADS = ["//evil.example", "https://evil.example"];

export const REDIRECT_PARAM_NAMES = [
  "url",
  "redirect",
  "next",
  "return",
  "return_to",
  "target",
  "dest",
  "goto",
  "redirect_url",
];

/** IDOR: alleen publieke sequentiële id's na een numeriek pad-segment. */
export const IDOR_PROBE_IDS = [1, 2, 3];

/** Input-validation: overlange invoer + speciale tekens. */
export const INPUT_VALIDATION_PAYLOADS = [
  "a".repeat(2000),
  "<>\"'\\",
  "%00",
];

export const GRAPHQL_INTROSPECTION_QUERY =
  "{__schema{queryType{name}types{name}}}";

/** Klein curated pad-lijstje voor debug/admin-endpoint-detectie. */
export const DEBUG_ENDPOINTS = [
  "/.env",
  "/server-status",
  "/phpinfo.php",
  "/actuator",
  "/debug",
  "/.git/config",
];

export const DEBUG_PAGE_PATTERN =
  /(phpinfo|laravel|symfony|environment|actuator|debug|version info)/i;

/** Velden die op een CSRF-token duiden in formulier-hidden-inputs. */
export const CSRF_TOKEN_NAMES = [
  "csrf",
  "csrf_token",
  "_token",
  "authenticity_token",
  "__RequestVerificationToken",
  "xsrf",
];