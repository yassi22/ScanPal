import { z } from "zod";

/**
 * Features 46–48 — SAST-finding-parsers (category github). Puur logica voor het
 * normaliseren van Semgrep / Gitleaks / OSV-Scanner JSON-output naar een
 * uniforme lijst issues + evidence-builders. De worker-wrappers in
 * `apps/worker/src/checks/github/` draaien de tools (via Docker, AGENTS.md)
 * en voeren de ruwe JSON aan deze parsers.
 *
 * Besluiten:
 * - Match-previews worden gemaskeerd (zie `maskMatch`): nooit meer dan
 *   4+4 tekens zichtbaar (geen volledige secrets in evidence/logs).
 * - Severity wordt per tool gemapt op {high, medium, low, critical} (de
 *   shared FindingSeverity-vierheid + critical).
 */

/* ---------------------------- masking ---------------------------- */

/** Maskeert een secret-match: nooit de volledige waarde; lange waarden → max 4+4 zichtbaar, korte (≤8) → eerste teken als type-hint. */
export function maskMatch(secret: string): string {
  if (secret.length === 0) return "";
  if (secret.length <= 8) return `${secret[0]}…`;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/* ---------------------------- Semgrep (46) ---------------------------- */

const SEMGREP_SEVERITY_MAP: Record<string, "high" | "medium" | "low"> = {
  ERROR: "high",
  WARNING: "medium",
  INFO: "low",
};

export type SemgrepIssue = {
  check_id: string;
  path: string;
  line: number;
  message: string;
  severity: "high" | "medium" | "low";
};

export const semgrepIssueSchema = z.object({
  check_id: z.string(),
  path: z.string(),
  line: z.number().int(),
  message: z.string(),
  severity: z.enum(["high", "medium", "low"]),
});

export function parseSemgrepJson(json: unknown): SemgrepIssue[] {
  if (!json || typeof json !== "object") return [];
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const issues: SemgrepIssue[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const row = r as {
      check_id?: unknown;
      path?: unknown;
      start?: unknown;
      extra?: unknown;
    };
    if (typeof row.check_id !== "string" || typeof row.path !== "string") continue;
    const start = (row.start ?? {}) as { line?: unknown };
    const extra = (row.extra ?? {}) as {
      message?: unknown;
      severity?: unknown;
    };
    const sev = typeof extra.severity === "string" ? extra.severity.toUpperCase() : "";
    issues.push({
      check_id: row.check_id,
      path: row.path,
      line: typeof start.line === "number" ? start.line : 0,
      message: typeof extra.message === "string" ? extra.message : "",
      severity: SEMGREP_SEVERITY_MAP[sev] ?? "medium",
    });
  }
  return issues;
}

export type SemgrepEvidence = {
  kind: "semgrep";
  total: number;
  by_severity: { high: number; medium: number; low: number };
  samples: { check_id: string; path: string; line: number; severity: string; message: string }[];
};

export const semgrepEvidenceSchema = z.object({
  kind: z.literal("semgrep"),
  total: z.number().int(),
  by_severity: z.object({
    high: z.number().int(),
    medium: z.number().int(),
    low: z.number().int(),
  }),
  samples: z.array(
    z.object({
      check_id: z.string(),
      path: z.string(),
      line: z.number().int(),
      severity: z.string(),
      message: z.string(),
    }),
  ),
});

export function semgrepEvidence(issues: SemgrepIssue[]): SemgrepEvidence {
  const by = { high: 0, medium: 0, low: 0 };
  for (const i of issues) by[i.severity] += 1;
  return {
    kind: "semgrep",
    total: issues.length,
    by_severity: by,
    samples: issues.slice(0, 10).map((i) => ({
      check_id: i.check_id,
      path: i.path,
      line: i.line,
      severity: i.severity,
      message: i.message,
    })),
  };
}

/** Overall Semgrep-status: high>0 → fail, medium>0 → warn, anders pass. */
export function semgrepStatus(issues: SemgrepIssue[]): "pass" | "warn" | "fail" {
  if (issues.some((i) => i.severity === "high")) return "fail";
  if (issues.some((i) => i.severity === "medium")) return "warn";
  return "pass";
}

/* ---------------------------- Gitleaks (47) ---------------------------- */

export type GitleaksIssue = {
  rule_id: string;
  file: string;
  start_line: number;
  match_preview: string;
  description: string;
};

export const gitleaksIssueSchema = z.object({
  rule_id: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  match_preview: z.string(),
  description: z.string(),
});

export function parseGitleaksJson(json: unknown): GitleaksIssue[] {
  if (!Array.isArray(json)) return [];
  const issues: GitleaksIssue[] = [];
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const row = r as {
      RuleID?: unknown;
      File?: unknown;
      StartLine?: unknown;
      Match?: unknown;
      Secret?: unknown;
      Description?: unknown;
    };
    const match = typeof row.Match === "string" ? row.Match : typeof row.Secret === "string" ? row.Secret : "";
    issues.push({
      rule_id: typeof row.RuleID === "string" ? row.RuleID : "unknown",
      file: typeof row.File === "string" ? row.File : "",
      start_line: typeof row.StartLine === "number" ? row.StartLine : 0,
      match_preview: maskMatch(match),
      description: typeof row.Description === "string" ? row.Description : "",
    });
  }
  return issues;
}

export type GitleaksEvidence = {
  kind: "gitleaks";
  total: number;
  samples: { rule_id: string; file: string; start_line: number; match_preview: string }[];
};

export const gitleaksEvidenceSchema = z.object({
  kind: z.literal("gitleaks"),
  total: z.number().int(),
  samples: z.array(
    z.object({
      rule_id: z.string(),
      file: z.string(),
      start_line: z.number().int(),
      match_preview: z.string(),
    }),
  ),
});

export function gitleaksEvidence(issues: GitleaksIssue[]): GitleaksEvidence {
  return {
    kind: "gitleaks",
    total: issues.length,
    samples: issues.slice(0, 10).map((i) => ({
      rule_id: i.rule_id,
      file: i.file,
      start_line: i.start_line,
      match_preview: i.match_preview,
    })),
  };
}

/** Gitleaks: elke gelekte secret = critical → fail bij >0. */
export function gitleaksStatus(issues: GitleaksIssue[]): "pass" | "fail" {
  return issues.length > 0 ? "fail" : "pass";
}

/* ---------------------------- OSV-Scanner (48) ---------------------------- */

export type OsvSeverity = "critical" | "high" | "medium" | "low";

export type OsvVulnerability = {
  id: string;
  package_name: string;
  ecosystem: string;
  version: string;
  summary: string;
  severity: OsvSeverity;
};

export const osvVulnerabilitySchema = z.object({
  id: z.string(),
  package_name: z.string(),
  ecosystem: z.string(),
  version: z.string(),
  summary: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
});

const CVSS_SEVERITY_ORDER: OsvSeverity[] = ["low", "medium", "high", "critical"];

/** Vertaalt een CVSS v3 base-score naar een ScanPal-severity. */
export function cvssToSeverity(score: number): OsvSeverity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function worstSeverity(sevs: OsvSeverity[]): OsvSeverity {
  if (sevs.length === 0) return "medium";
  return sevs.reduce((acc, s) =>
    CVSS_SEVERITY_ORDER.indexOf(s) > CVSS_SEVERITY_ORDER.indexOf(acc) ? s : acc,
  );
}

function parseCvssScore(score: unknown): number | null {
  if (typeof score === "number") return score;
  if (typeof score === "string") {
    // "CVSS:3.1/AV:N/..." → geen base-score; probeer trailing float
    const m = score.match(/(\d+(?:\.\d+)?)\s*$/);
    if (m) return parseFloat(m[1]);
    return null;
  }
  return null;
}

/**
 * Trekt de severity-signalen uit één OSV-vuln-object (zowel de `severity`-array
 * met CVSS-scores als `database_specific.severity` voor GHSA-style advisories).
 * Gedeeld door de osv-scanner-JSON-parser en de OSV-REST-API-client (plan 71).
 */
export function extractOsvSeverities(vv: {
  severity?: unknown;
  database_specific?: unknown;
}): OsvSeverity[] {
  const sevs: OsvSeverity[] = [];
  if (Array.isArray(vv.severity)) {
    for (const s of vv.severity) {
      if (!s || typeof s !== "object") continue;
      const ss = s as { type?: unknown; score?: unknown };
      if (typeof ss.score !== "undefined") {
        const parsed = parseCvssScore(ss.score);
        if (parsed !== null) sevs.push(cvssToSeverity(parsed));
      }
    }
  }
  // database_specific.severity (GHSA-style: "HIGH"/"MODERATE"/"LOW"/"CRITICAL")
  const dbSpec = (vv.database_specific ?? {}) as { severity?: unknown };
  if (typeof dbSpec.severity === "string") {
    const upper = dbSpec.severity.toUpperCase();
    if (upper === "CRITICAL") sevs.push("critical");
    else if (upper === "HIGH") sevs.push("high");
    else if (upper === "MODERATE" || upper === "MEDIUM") sevs.push("medium");
    else if (upper === "LOW") sevs.push("low");
  }
  return sevs;
}

/**
 * Normaliseert één ruw OSV-vuln-object naar de `OsvVulnerability`-vorm. Gedeeld
 * door `parseOsvJson` (osv-scanner Docker-JSON) en `queryOsvBatch` (REST API,
 * plan 71) zodat severity-interpretatie over beide bronnen identiek is.
 */
export function normalizeOsvVulnerability(
  vv: { id?: unknown; summary?: unknown; severity?: unknown; database_specific?: unknown },
  pkgName: string,
  ecosystem: string,
  version: string,
): OsvVulnerability {
  return {
    id: typeof vv.id === "string" ? vv.id : "unknown",
    package_name: pkgName,
    ecosystem,
    version,
    summary: typeof vv.summary === "string" ? vv.summary : "",
    severity: worstSeverity(extractOsvSeverities(vv)),
  };
}

export function parseOsvJson(json: unknown): OsvVulnerability[] {
  if (!json || typeof json !== "object") return [];
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const vulns: OsvVulnerability[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const row = r as {
      package?: unknown;
      version?: unknown;
      vulnerabilities?: unknown;
    };
    const pkg = (row.package ?? {}) as { name?: unknown; ecosystem?: unknown };
    const pkgName = typeof pkg.name === "string" ? pkg.name : "";
    const ecosystem = typeof pkg.ecosystem === "string" ? pkg.ecosystem : "";
    const version = typeof row.version === "string" ? row.version : "";
    const vulnerabilities = row.vulnerabilities;
    if (!Array.isArray(vulnerabilities)) continue;
    for (const v of vulnerabilities) {
      if (!v || typeof v !== "object") continue;
      vulns.push(normalizeOsvVulnerability(v as Record<string, unknown>, pkgName, ecosystem, version));
    }
  }
  return vulns;
}

export type OsvEvidence = {
  kind: "osv-scanner";
  total: number;
  by_severity: { critical: number; high: number; medium: number; low: number };
  samples: { id: string; package_name: string; version: string; severity: string }[];
};

export const osvEvidenceSchema = z.object({
  kind: z.literal("osv-scanner"),
  total: z.number().int(),
  by_severity: z.object({
    critical: z.number().int(),
    high: z.number().int(),
    medium: z.number().int(),
    low: z.number().int(),
  }),
  samples: z.array(
    z.object({
      id: z.string(),
      package_name: z.string(),
      version: z.string(),
      severity: z.string(),
    }),
  ),
});

export function osvEvidence(vulns: OsvVulnerability[]): OsvEvidence {
  const by = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of vulns) by[v.severity] += 1;
  return {
    kind: "osv-scanner",
    total: vulns.length,
    by_severity: by,
    samples: vulns.slice(0, 10).map((v) => ({
      id: v.id,
      package_name: v.package_name,
      version: v.version,
      severity: v.severity,
    })),
  };
}

/** OSV: critical/high → fail, medium/low → warn, anders pass. */
export function osvStatus(vulns: OsvVulnerability[]): "pass" | "warn" | "fail" {
  if (vulns.some((v) => v.severity === "critical" || v.severity === "high")) return "fail";
  if (vulns.some((v) => v.severity === "medium" || v.severity === "low")) return "warn";
  return "pass";
}
