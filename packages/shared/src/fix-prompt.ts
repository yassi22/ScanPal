import { z } from "zod";
import { checkById } from "./check-catalog";
import { evidenceText, type Finding } from "./findings";
import { severityRank, type FindingSeverity } from "./severity";

/**
 * AI fix-prompts (plan 60): deterministische promptbouw uit de finding +
 * template per check-id — geen LLM-call. Engelse prompts (voor AI-editors),
 * met locatie (bestandspad bij gekoppelde repo, anders route/URL) en de
 * remediatie uit de finding. De scan-prompt groepeert niet-fixed/ignored
 * findings per bestand/route en truncates op een tokenbudget.
 */

export const FIX_PROMPT_MAX_TOKENS = 1500;
export const FIX_PROMPT_SINGLE_EVIDENCE_MAX = 800;
export const FIX_PROMPT_GROUPED_EVIDENCE_MAX = 240;

export const fixPromptSchema = z.object({
  prompt: z.string(),
  findings_covered: z.number().int().min(0),
  truncated: z.boolean(),
});
export type FixPrompt = z.infer<typeof fixPromptSchema>;

/** Context van de site/scan waar de findings vandaan komen. */
export type FixPromptScope = {
  siteUrl: string;
  siteLabel: string | null;
  githubRepo: string | null;
  scanId: string;
  scanCreatedAt: string;
};

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export function severityLabelForPrompt(severity: FindingSeverity): string {
  return SEVERITY_LABEL[severity];
}

export const fallbackFixPromptTemplate =
  "You are a senior engineer. Resolve the issue described below with the " +
  "minimal targeted change, following the remediation guidance.";

/** Rol + doel per check-id (Engels); onbekende check-ids → fallback. */
export const fixPromptTemplates: Record<string, string> = {
  reachability:
    "You are a senior SRE. The site is unreachable — diagnose and restore availability (DNS, server process, hosting, domain expiry).",
  https:
    "You are a security engineer. Enforce HTTPS: obtain or renew the TLS certificate and redirect all HTTP traffic to HTTPS.",
  "security-header-csp":
    "You are a security engineer. Implement a strict Content-Security-Policy header on all responses and remove unsafe inline scripts/styles where possible.",
  "security-header-hsts":
    "You are a security engineer. Enable HSTS (Strict-Transport-Security) with a long max-age and includeSubDomains.",
  "security-header-xcto":
    "You are a security engineer. Set X-Content-Type-Options: nosniff on all responses.",
  "security-header-xfo":
    "You are a security engineer. Prevent clickjacking with X-Frame-Options: DENY/SAMEORIGIN or a CSP frame-ancestors directive.",
  "security-header-referrer-policy":
    "You are a security engineer. Set a safe Referrer-Policy such as strict-origin-when-cross-origin.",
  "security-header-permissions-policy":
    "You are a security engineer. Restrict browser features with a Permissions-Policy allowlist.",
  "security-header-coop":
    "You are a security engineer. Set Cross-Origin-Opener-Policy: same-origin to isolate browsing contexts.",
  "security-header-coep":
    "You are a security engineer. Set Cross-Origin-Embedder-Policy: require-corp or credentialless.",
  "cookie-httponly":
    "You are a security engineer. Mark the affected cookies HttpOnly so they cannot be read by JavaScript.",
  "cookie-secure":
    "You are a security engineer. Send the affected cookies only over HTTPS (Secure attribute).",
  "cookie-samesite":
    "You are a security engineer. Set SameSite on the affected cookies (Lax or Strict); SameSite=None only together with Secure.",
  "cookie-prefixes":
    "You are a security engineer. Use __Host- or __Secure- cookie prefixes only together with the required attributes.",
  "cookie-expiry":
    "You are a security engineer. Make the session cookies non-persistent (no Expires/Max-Age).",
  cors:
    "You are a security engineer. Harden the CORS configuration: use an explicit origin allowlist, never reflect the Origin header, and gate credentials carefully.",
  "tls-cert":
    "You are a security engineer. Renew the TLS certificate before it expires and make sure the SAN/CN matches the hostname.",
  "domain-watchtower":
    "You are a security engineer. Renew the domain registration and enable DNSSEC before the expiry runway is over.",
  "redirects-mixed":
    "You are a security engineer. Remove mixed content and fix redirect chains that break HTTPS or lose link equity.",
  "secrets-in-html":
    "You are a security engineer. Remove the exposed secrets from HTML and rotate any credentials that may have leaked.",
  "secrets-in-bundles":
    "You are a security engineer. Remove exposed API keys/secrets from the client bundles and rotate the leaked keys.",
  subresources:
    "You are a security engineer. Harden subresource loading with Subresource Integrity and remove untrusted third-party resources.",
  "meta-tags":
    "You are an SEO engineer. Add unique, descriptive meta tags (title, description, Open Graph) to the affected pages.",
  "robots-sitemap":
    "You are an SEO engineer. Fix robots.txt and the sitemap so search engines can crawl and index the site correctly.",
  "security-txt":
    "You are a security engineer. Publish security.txt, a proper favicon and a friendly 404 page.",
  "mini-crawl":
    "You are an SEO engineer. Fix the internal and broken links found during the crawl.",
  "structured-data":
    "You are an SEO engineer. Fix the JSON-LD structured data so it validates and describes the page correctly.",
  "aeo-engine-matrix":
    "You are an AEO engineer. Make the page reachable and parseable for AI crawlers (robots.txt, WAF, server-side rendering) and publish a valid llms.txt.",
  "core-web-vitals":
    "You are a front-end performance engineer. Improve the Core Web Vitals metrics for the affected pages.",
  accessibility:
    "You are an accessibility engineer. Fix the axe-core violations on the affected pages.",
  "aeo-scan":
    "You are an AEO engineer. Improve the AI-engine parsability of the page content (headings, text density, structured content).",
  semgrep:
    "You are a security engineer. Fix the code quality and security issues reported by Semgrep in the repository files.",
  gitleaks:
    "You are a security engineer. Remove the leaked secrets found by Gitleaks, rotate them, and move secrets out of source control.",
  "osv-scanner":
    "You are a security engineer. Upgrade or replace the vulnerable dependencies reported by OSV-Scanner.",
  "repo-health":
    "You are a software engineer. Improve repository health by fixing the reported repo-level issues.",
  "sqli-probe":
    "You are a security engineer. Fix the SQL injection vulnerability found at the affected route (use parameterized queries).",
  "xss-probe":
    "You are a security engineer. Fix the reflected XSS vulnerability found at the affected route (encode output on reflection).",
  "csrf-check":
    "You are a security engineer. Add CSRF protection to the affected form or endpoint.",
  "open-redirect-probe":
    "You are a security engineer. Fix the open redirect at the affected route (validate and allowlist the redirect target).",
  "idor-probe":
    "You are a security engineer. Fix the IDOR at the affected route (enforce authorization on every object access).",
  "input-validation":
    "You are a security engineer. Add server-side input validation to the affected endpoint.",
  "debug-endpoints":
    "You are a security engineer. Disable or remove the exposed debug/admin endpoints and protect sensitive files.",
  "graphql-introspection":
    "You are a security engineer. Disable GraphQL introspection in production.",
  "jwt-audit":
    "You are a security engineer. Fix the JWT weakness found (algorithm confusion or weak signing key).",
  "webhook-signature":
    "You are a security engineer. Add signature verification to the webhook handlers.",
  "tenant-isolation":
    "You are a security engineer. Fix the cross-tenant data access issue found (enforce tenant scoping on every query).",
};

export function fixPromptTemplateFor(checkId: string): string {
  return fixPromptTemplates[checkId] ?? fallbackFixPromptTemplate;
}

/** Grove token-schatting (~4 chars per token), gebruikt voor het budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Kapt op karakters, op een woordgrens, met een ellips. */
export function trimToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s+\S*$/, "") + "…";
}

/** Vrije tekst van evidence op één regel voor compacte prompt-blokken. */
function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Sanitize attacker-beïnvloede prompt-inhoud (evidence, descriptions):
 * control-chars/NUL eruit, en een code-fence kiezen die langer is dan elke
 * backtick-run in de inhoud, zodat ```-fences in de evidence de prompt niet
 * kunnen breken (prompt-injection via gefence-de uitbraak, plan 60).
 */
export function sanitizePromptText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function fenceFor(text: string): string {
  const runs = sanitizePromptText(text).match(/`+/g)?.map((m) => m.length) ?? [];
  const max = runs.length > 0 ? Math.max(...runs) : 0;
  return "`".repeat(Math.max(3, max + 1));
}

const FILE_EXT = "(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|kt|kts|cs|c|cpp|cc|h|hpp|json|ya?ml|toml|ini|cfg|conf|config|env|properties|xml|html|htm|css|scss|sass|less|sql|md|sh|bash|ps1|tf|gradle|lock)";

/**
 * Haalt een bestandspad uit string-evidence (semgrep/gitleaks/osv): eerst een
 * pad met directories, anders een losse filenaam met een code-extension.
 */
export function extractFilePath(text: string | null): string | null {
  if (!text) return null;
  const withPath = new RegExp(
    `(?<![\\w])((?:[\\w.\\-]+/)+[\\w.\\-]+\\.(?:${FILE_EXT}))(?::\\d+(?::\\d+)?)?`,
    "i",
  );
  const pathMatch = text.match(withPath);
  if (pathMatch) return pathMatch[1];
  const bare = new RegExp(
    `(?<![\\w.])([\\w.\\-]*\\.(?:${FILE_EXT}))(?::\\d+(?::\\d+)?)?`,
    "i",
  );
  const bareMatch = text.match(bare);
  return bareMatch ? bareMatch[1] : null;
}

function checkNameOf(checkId: string): string {
  return checkById(checkId)?.name ?? checkId;
}

/**
 * Locatie van een finding (besluit 3): bij gekoppelde repo + github-findings
 * het bestandspad uit de evidence; anders route_url (plan 54) + check-uitleg;
 * zonder repo alleen de site-URL + check-uitleg.
 */
export function findingLocation(finding: Finding, scope: FixPromptScope): string {
  const repoLine = scope.githubRepo
    ? `\nRepository: https://github.com/${scope.githubRepo}`
    : "";
  if (scope.githubRepo && finding.category === "github") {
    const file = extractFilePath(evidenceText(finding.evidence));
    if (file) return `File: https://github.com/${scope.githubRepo}/blob/main/${file}`;
  }
  const where = finding.route_url
    ? `Route: ${finding.route_url}`
    : `Site: ${scope.siteUrl}`;
  return `${where}${repoLine}\nCheck: ${checkNameOf(finding.check_id)}`;
}

function groupKey(finding: Finding, scope: FixPromptScope): string {
  if (scope.githubRepo && finding.category === "github") {
    return extractFilePath(evidenceText(finding.evidence)) ?? "repository";
  }
  return finding.route_url ?? scope.siteUrl;
}

function groupTitle(key: string, finding: Finding, scope: FixPromptScope): string {
  if (key === "repository") {
    return `Repository: https://github.com/${scope.githubRepo}`;
  }
  if (scope.githubRepo && finding.category === "github") {
    return `File: https://github.com/${scope.githubRepo}/blob/main/${key}`;
  }
  return key === scope.siteUrl ? `Site: ${scope.siteUrl}` : `Route: ${key}`;
}

function promptHeader(scope: FixPromptScope): string {
  const name = scope.siteLabel ?? scope.siteUrl;
  const lines = [
    `# Fix prompt — ${name}`,
    "",
    `Site: ${scope.siteUrl}`,
    `Scan: ${scope.scanId}`,
  ];
  if (scope.githubRepo) lines.push(`Repository: https://github.com/${scope.githubRepo}`);
  return lines.join("\n");
}

const REQUIREMENTS = [
  "## Requirements",
  "- Make the minimal change needed to resolve the finding(s).",
  "- Do not change unrelated code.",
  "- Run the relevant tests / build and confirm they pass.",
  "- Provide the changes as a diff when done.",
  "",
];

/** Eén copy-paste prompt voor één finding. */
export function buildFindingFixPrompt(
  finding: Finding,
  scope: FixPromptScope,
): string {
  const template = fixPromptTemplateFor(finding.check_id);
  const evidence = trimToChars(
    evidenceText(finding.evidence),
    FIX_PROMPT_SINGLE_EVIDENCE_MAX,
  );
  const lines: string[] = [];
  lines.push(promptHeader(scope), "");
  lines.push("## Role & goal", "", template, "");
  lines.push("## Problem", "", `${finding.title} — ${SEVERITY_LABEL[finding.severity]}`, "");
  lines.push("## Location", "", findingLocation(finding, scope), "");
  lines.push("## Description", "", sanitizePromptText(finding.description), "");
  lines.push("## Remediation", "", sanitizePromptText(finding.remediation), "");
  if (evidence) {
    const fence = fenceFor(evidence);
    lines.push("## Evidence", "", fence, sanitizePromptText(evidence), fence, "");
  }
  lines.push(...REQUIREMENTS);
  return lines.join("\n");
}

/**
 * Eén prompt voor alle niet-fixed/ignored findings, gegroepeerd per
 * bestand/route (besluit 5/6). Truncateert op het tokenbudget met
 * "… and N more" en telt de findings_covered.
 */
export function buildScanFixPrompt(
  findings: Finding[],
  scope: FixPromptScope,
): FixPrompt {
  const sorted = findings
    .filter((finding) => finding.status === "open")
    .sort(
      (a, b) =>
        severityRank[b.severity] - severityRank[a.severity] ||
        a.title.localeCompare(b.title),
    );

  const header = `${promptHeader(scope)}\n\n## Findings to fix\n`;
  const blocks: string[] = [];
  let previousKey: string | null = null;
  for (const finding of sorted) {
    const key = groupKey(finding, scope);
    const block: string[] = [];
    if (key !== previousKey) {
      block.push("", `### ${groupTitle(key, finding, scope)}`, "");
      previousKey = key;
    }
    block.push(`#### ${finding.title} (${SEVERITY_LABEL[finding.severity]})`);
    block.push(`- **Check:** ${checkNameOf(finding.check_id)}`);
    block.push(`- **Description:** ${singleLine(sanitizePromptText(finding.description))}`);
    block.push(`- **Remediation:** ${singleLine(sanitizePromptText(finding.remediation))}`);
    const evidence = trimToChars(
      evidenceText(finding.evidence),
      FIX_PROMPT_GROUPED_EVIDENCE_MAX,
    );
    if (evidence) {
      block.push(`- **Evidence:** ${singleLine(sanitizePromptText(evidence))}`);
    }
    block.push("");
    blocks.push(block.join("\n"));
  }

  // Reserveer ruimte voor de footer (requirements + evt. "and N more") zodat de
  // uiteindelijke prompt nooit boven het budget uitkomt.
  const FOOTER_HEADROOM_TOKENS = 120;
  let prompt = header;
  let covered = 0;
  let truncated = false;
  for (const block of blocks) {
    if (
      estimateTokens(prompt + block) >
      FIX_PROMPT_MAX_TOKENS - FOOTER_HEADROOM_TOKENS
    ) {
      truncated = true;
      break;
    }
    prompt += block;
    covered++;
  }

  const omitted = sorted.length - covered;
  prompt += "\n";
  if (truncated && omitted > 0) {
    prompt +=
      `\n… and ${omitted} more finding${omitted === 1 ? "" : "s"} omitted (token limit).\n`;
  }
  prompt += REQUIREMENTS.join("\n");

  return { prompt, findings_covered: covered, truncated };
}