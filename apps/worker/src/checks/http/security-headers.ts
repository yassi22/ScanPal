import { checkById, type FindingSeverity, type InlineCheckLike } from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const SECURITY_HEADER_CHECK_IDS = [
  "security-header-csp",
  "security-header-hsts",
  "security-header-xcto",
  "security-header-xfo",
  "security-header-referrer-policy",
  "security-header-permissions-policy",
  "security-header-coop",
  "security-header-coep",
] as const;

const HEADER_NAMES: Record<string, string> = {
  "security-header-csp": "content-security-policy",
  "security-header-hsts": "strict-transport-security",
  "security-header-xcto": "x-content-type-options",
  "security-header-xfo": "x-frame-options",
  "security-header-referrer-policy": "referrer-policy",
  "security-header-permissions-policy": "permissions-policy",
  "security-header-coop": "cross-origin-opener-policy",
  "security-header-coep": "cross-origin-embedder-policy",
};

type Issue = { severity: "medium" | "low"; detail: string };

/** Header-bron: minimaal de `get`-interface van de Fetch `Headers`-API. */
export type HeaderSource = { get(name: string): string | null };

export function parseCspDirectives(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    const existing = directives.get(name) ?? [];
    directives.set(name, existing.concat(tokens.slice(1)));
  }
  return directives;
}

export function cspIssues(csp: string): Issue[] {
  const d = parseCspDirectives(csp);
  const issues: Issue[] = [];
  const has = (directive: string, needle: string) =>
    (d.get(directive) ?? []).some((token) => token.toLowerCase() === needle);

  if (has("script-src", "'unsafe-inline'") || has("style-src", "'unsafe-inline'")) {
    issues.push({ severity: "medium", detail: "unsafe-inline staat aan in script-src/style-src" });
  }
  if (has("script-src", "'unsafe-eval'") || has("style-src", "'unsafe-eval'")) {
    issues.push({ severity: "medium", detail: "unsafe-eval staat aan in script-src/style-src" });
  }
  if (has("script-src", "*") || has("default-src", "*")) {
    issues.push({ severity: "medium", detail: "wildcard (*) in script-src/default-src" });
  }
  if (!d.has("default-src")) {
    issues.push({ severity: "low", detail: "geen default-src ingesteld" });
  }
  return issues;
}

export function hstsIssues(value: string): Issue[] {
  const parts = value
    .split(";")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const issues: Issue[] = [];
  const maxAgeMatch = parts.map((p) => /^max-age=(\d+)/.exec(p)).find(Boolean);
  const maxAge = maxAgeMatch ? Number.parseInt(maxAgeMatch[1], 10) : null;
  if (maxAge === null || maxAge < 31536000) {
    issues.push({
      severity: "medium",
      detail: "max-age ontbreekt of is korter dan 31536000 seconden",
    });
  }
  if (!parts.includes("includesubdomains")) {
    issues.push({ severity: "low", detail: "includeSubDomains ontbreekt" });
  }
  return issues;
}

export function xctoIssues(value: string): Issue[] {
  return value.trim().toLowerCase() === "nosniff"
    ? []
    : [{ severity: "medium", detail: `waarde is "${value.trim()}" i.p.v. nosniff` }];
}

export function xfoIssues(value: string): Issue[] {
  const upper = value.trim().toUpperCase();
  if (upper === "DENY" || upper === "SAMEORIGIN") return [];
  if (upper.startsWith("ALLOW-FROM")) {
    return [{ severity: "medium", detail: "ALLOW-FROM is deprecated" }];
  }
  return [
    {
      severity: "medium",
      detail: `onbekende waarde "${value.trim()}" (verwacht DENY of SAMEORIGIN)`,
    },
  ];
}

export function referrerPolicyIssues(value: string): Issue[] {
  const policies = value
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (policies.includes("unsafe-url")) {
    return [{ severity: "medium", detail: "unsafe-url lekt de volledige URL naar derden" }];
  }
  return [];
}

const SENSITIVE_PERMISSIONS = ["camera", "microphone", "geolocation"];

export function permissionsPolicyIssues(value: string): Issue[] {
  const issues: Issue[] = [];
  for (const directive of value.split(",").map((d) => d.trim()).filter(Boolean)) {
    const eq = directive.indexOf("=");
    let feature: string;
    let allowlist: string;
    if (eq >= 0) {
      feature = directive.slice(0, eq).trim().toLowerCase();
      allowlist = directive.slice(eq + 1).trim().toLowerCase();
    } else {
      const [featureName, ...rest] = directive.trim().toLowerCase().split(/\s+/);
      feature = featureName;
      allowlist = rest.join(" ");
    }
    if (!SENSITIVE_PERMISSIONS.includes(feature)) continue;
    if (allowlist === "*" || allowlist === "all") {
      issues.push({ severity: "low", detail: `${feature} staat open voor alle origins (*)` });
    }
  }
  return issues;
}

export function coopIssues(value: string): Issue[] {
  const lower = value.trim().toLowerCase();
  if (lower === "unsafe-none") {
    return [{ severity: "medium", detail: "unsafe-none biedt geen cross-origin isolatie" }];
  }
  if (lower === "same-origin" || lower === "same-origin-allow-popups") return [];
  return [
    {
      severity: "medium",
      detail: `onbekende waarde "${value.trim()}" (verwacht same-origin of same-origin-allow-popups)`,
    },
  ];
}

export function coepIssues(value: string): Issue[] {
  const lower = value.trim().toLowerCase();
  if (lower === "require-corp" || lower === "credentialless") return [];
  return [
    {
      severity: "low",
      detail: `onbekende waarde "${value.trim()}" (verwacht require-corp of credentialless)`,
    },
  ];
}

function worstSeverity(issues: Issue[]): FindingSeverity {
  return issues.some((issue) => issue.severity === "medium") ? "medium" : "low";
}

function truncateValue(value: string): string {
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

function missingResult(id: string, name: string): InlineCheckLike {
  switch (id) {
    case "security-header-csp":
      return { id, name, status: "fail", detail: "Content-Security-Policy header ontbreekt" };
    case "security-header-hsts":
      return { id, name, status: "fail", detail: "Strict-Transport-Security header ontbreekt" };
    case "security-header-coep":
      return {
        id,
        name,
        status: "warn",
        severity: "low",
        detail: "Cross-Origin-Embedder-Policy header ontbreekt",
      };
    default:
      return { id, name, status: "warn", detail: `${name} header ontbreekt` };
  }
}

function issuesFor(id: string, value: string): Issue[] {
  switch (id) {
    case "security-header-csp":
      return cspIssues(value);
    case "security-header-hsts":
      return hstsIssues(value);
    case "security-header-xcto":
      return xctoIssues(value);
    case "security-header-xfo":
      return xfoIssues(value);
    case "security-header-referrer-policy":
      return referrerPolicyIssues(value);
    case "security-header-permissions-policy":
      return permissionsPolicyIssues(value);
    case "security-header-coop":
      return coopIssues(value);
    case "security-header-coep":
      return coepIssues(value);
    default:
      return [];
  }
}

/** Per-header evaluatie uit één gedeelde response (geen per-header requests). */
export function evaluateSecurityHeaders(headers: HeaderSource): InlineCheckLike[] {
  const csp = headers.get("content-security-policy");
  const results: InlineCheckLike[] = [];

  for (const id of SECURITY_HEADER_CHECK_IDS) {
    const entry = checkById(id);
    const name = entry?.name ?? id;
    const headerName = HEADER_NAMES[id];
    const value = headers.get(headerName);

    if (id === "security-header-xfo" && csp && parseCspDirectives(csp).has("frame-ancestors")) {
      results.push({
        id,
        name,
        status: "info",
        detail: "CSP frame-ancestors aanwezig — vervangt X-Frame-Options",
      });
      continue;
    }

    if (!value) {
      results.push(missingResult(id, name));
      continue;
    }

    const issues = issuesFor(id, value);
    if (issues.length === 0) {
      results.push({
        id,
        name,
        status: "pass",
        detail: `${name} is correct ingesteld ("${truncateValue(value)}")`,
      });
      continue;
    }

    results.push({
      id,
      name,
      status: "warn",
      severity: worstSeverity(issues),
      detail: issues.map((issue) => issue.detail).join("; "),
      evidence: value,
    });
  }
  return results;
}

function notCheckable(message: string): InlineCheckLike[] {
  return SECURITY_HEADER_CHECK_IDS.map((id) => {
    const entry = checkById(id);
    return {
      id,
      name: entry?.name ?? id,
      status: "info",
      detail: `Header niet controleerbaar: ${message}`,
    };
  });
}

export const securityHeadersCheck: CheckImplementation = {
  id: "security-headers",
  category: "http",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      return evaluateSecurityHeaders(response.headers);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return notCheckable(message);
    }
  },
};