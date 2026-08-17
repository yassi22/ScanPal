import { describe, it, expect } from "vitest";
import type { Finding } from "../findings";
import {
  buildFindingFixPrompt,
  buildScanFixPrompt,
  estimateTokens,
  extractFilePath,
  fallbackFixPromptTemplate,
  fixPromptSchema,
  fixPromptTemplateFor,
  fixPromptTemplates,
  findingLocation,
  severityLabelForPrompt,
  trimToChars,
  FIX_PROMPT_MAX_TOKENS,
  type FixPromptScope,
} from "../fix-prompt";

const NOW = "2026-08-15T09:00:00.000Z";

const SCOPE: FixPromptScope = {
  siteUrl: "example.com",
  siteLabel: "Example Site",
  githubRepo: null,
  scanId: "00000000-0000-4000-8000-000000000001",
  scanCreatedAt: NOW,
};

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "https:https-ontbreekt",
    check_id: "https",
    category: "http",
    severity: "high",
    title: "HTTPS ontbreekt",
    description: "Site is niet bereikbaar over HTTPS",
    remediation: "Regel een TLS-certificaat en forceer HTTPS",
    evidence: null,
    active: false,
    status: "open",
    note: null,
    created_at: NOW,
    route_url: null,
    regressed: false,
    snooze_until: null,
    ...overrides,
  };
}

describe("fixPromptTemplates", () => {
  it("heeft een template voor elke check-id uit de catalog", () => {
    for (const id of [
      "reachability",
      "https",
      "security-header-csp",
      "security-header-hsts",
      "security-header-xcto",
      "security-header-xfo",
      "security-header-referrer-policy",
      "security-header-permissions-policy",
      "security-header-coop",
      "security-header-coep",
      "cookie-httponly",
      "cookie-secure",
      "cookie-samesite",
      "cookie-prefixes",
      "cookie-expiry",
      "cors",
      "tls-cert",
      "domain-watchtower",
      "redirects-mixed",
      "secrets-in-html",
      "secrets-in-bundles",
      "subresources",
      "meta-tags",
      "robots-sitemap",
      "security-txt",
      "mini-crawl",
      "structured-data",
      "aeo-engine-matrix",
      "core-web-vitals",
      "accessibility",
      "aeo-scan",
      "semgrep",
      "gitleaks",
      "osv-scanner",
      "repo-health",
      "sqli-probe",
      "xss-probe",
      "csrf-check",
      "open-redirect-probe",
      "idor-probe",
      "input-validation",
      "debug-endpoints",
      "graphql-introspection",
      "jwt-audit",
      "webhook-signature",
      "tenant-isolation",
    ]) {
      expect(fixPromptTemplateFor(id)).not.toBe(fallbackFixPromptTemplate);
    }
  });

  it("valt terug op de generieke template voor onbekende check-ids", () => {
    expect(fixPromptTemplateFor("onbekende-check")).toBe(
      fallbackFixPromptTemplate,
    );
    expect(fixPromptTemplateFor("")).toBe(fallbackFixPromptTemplate);
  });

  it("templates zijn Engelstalig en non-empty", () => {
    expect(Object.keys(fixPromptTemplates).length).toBeGreaterThan(0);
    for (const template of Object.values(fixPromptTemplates)) {
      expect(template.length).toBeGreaterThan(20);
    }
  });
});

describe("estimateTokens + trimToChars", () => {
  it("schat tokens op ~4 karakters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(10))).toBe(3);
  });

  it("trimt op karakters met ellips en behoudt korte tekst intact", () => {
    expect(trimToChars("kort", 10)).toBe("kort");
    expect(trimToChars("a ".repeat(50), 20)).toMatch(/…$/);
  });
});

describe("extractFilePath", () => {
  it("haalt een pad uit semgrep-evidence", () => {
    expect(
      extractFilePath("src/auth/login.ts:12 High Insecure deserialization"),
    ).toBe("src/auth/login.ts");
    expect(
      extractFilePath("packages/web/src/api/users.js:45 medium"),
    ).toBe("packages/web/src/api/users.js");
  });

  it("haalt een losse filenaam op", () => {
    expect(extractFilePath("file: .env")).toBe(".env");
    expect(extractFilePath("gitleaks: secrets.env:3")).toBe("secrets.env");
  });

  it("geeft null zonder evidence of zonder bestandspad", () => {
    expect(extractFilePath(null)).toBeNull();
    expect(extractFilePath("geen pad hier")).toBeNull();
  });
});

describe("findingLocation", () => {
  it("gebruikt route_url + check-uitleg voor HTTP-findings", () => {
    const location = findingLocation(
      makeFinding({ route_url: "https://example.com/account" }),
      SCOPE,
    );
    expect(location).toContain("Route: https://example.com/account");
    expect(location).toContain("Check: HTTPS");
  });

  it("gebruikt alleen de site-URL + check zonder repo en zonder route", () => {
    const location = findingLocation(makeFinding(), SCOPE);
    expect(location).toContain("Site: example.com");
    expect(location).toContain("Check: HTTPS");
    expect(location).not.toContain("github.com");
  });

  it("zet een bestandspad bij gekoppelde repo + github-finding", () => {
    const location = findingLocation(
      makeFinding({
        category: "github",
        check_id: "gitleaks",
        evidence: "src/config.js:7 leaked secret",
      }),
      { ...SCOPE, githubRepo: "acme/web" },
    );
    expect(location).toBe(
      "File: https://github.com/acme/web/blob/main/src/config.js",
    );
  });

  it("verwijst naar de repo zonder bestandspad", () => {
    const location = findingLocation(
      makeFinding({ category: "github", check_id: "semgrep" }),
      { ...SCOPE, githubRepo: "acme/web" },
    );
    expect(location).toContain("Repository: https://github.com/acme/web");
  });
});

describe("buildFindingFixPrompt", () => {
  it("bouwt een Engelse prompt met rol, probleem, locatie en remediatie", () => {
    const prompt = buildFindingFixPrompt(
      makeFinding({
        title: "HTTPS ontbreekt",
        severity: "high",
        description: "Site is niet bereikbaar over HTTPS",
        remediation: "Regel een TLS-certificaat en forceer HTTPS",
        evidence: "curl -I http://example.com → 200",
      }),
      SCOPE,
    );

    expect(prompt).toContain("# Fix prompt — Example Site");
    expect(prompt).toContain("## Role & goal");
    expect(prompt).toContain("security engineer");
    expect(prompt).toContain("## Problem");
    expect(prompt).toContain("HTTPS ontbreekt — High");
    expect(prompt).toContain("## Location");
    expect(prompt).toContain("Site: example.com");
    expect(prompt).toContain("## Remediation");
    expect(prompt).toContain("Regel een TLS-certificaat en forceer HTTPS");
    expect(prompt).toContain("## Evidence");
    expect(prompt).toContain("curl -I http://example.com → 200");
    expect(prompt).toContain("Provide the changes as a diff when done.");
    expect(prompt).not.toContain("Kopieer");
  });

  it("verwijst naar het bestand bij een gekoppelde repo + github-finding", () => {
    const prompt = buildFindingFixPrompt(
      makeFinding({
        check_id: "semgrep",
        category: "github",
        evidence: "src/auth.ts:22 weak password hash",
      }),
      { ...SCOPE, githubRepo: "acme/web" },
    );
    expect(prompt).toContain(
      "File: https://github.com/acme/web/blob/main/src/auth.ts",
    );
  });

  it("geen evidence-sectie zonder evidence", () => {
    const prompt = buildFindingFixPrompt(makeFinding({ evidence: null }), SCOPE);
    expect(prompt).not.toContain("## Evidence");
  });
});

describe("buildScanFixPrompt", () => {
  it("groepeert per bestand/route en sluit fixed/ignored uit", () => {
    const findings = [
      makeFinding({
        id: "a:high",
        severity: "critical",
        title: "Kritiek",
        route_url: "https://example.com/login",
      }),
      makeFinding({
        id: "b:low",
        severity: "low",
        title: "Laag",
        route_url: "https://example.com/login",
      }),
      makeFinding({
        id: "c:fixed",
        severity: "high",
        title: "Opgelost",
        status: "fixed",
        route_url: "https://example.com/login",
      }),
      makeFinding({
        id: "d:ignored",
        severity: "high",
        title: "Genegeerd",
        status: "ignored",
      }),
      makeFinding({
        id: "e:site",
        severity: "medium",
        title: "Site-level",
      }),
    ];

    const result = buildScanFixPrompt(findings, SCOPE);
    expect(result.truncated).toBe(false);
    expect(result.findings_covered).toBe(3);
    expect(result.prompt).toContain("### Route: https://example.com/login");
    expect(result.prompt).toContain("### Site: example.com");
    expect(result.prompt).not.toContain("Opgelost");
    expect(result.prompt).not.toContain("Genegeerd");
    expect(result.prompt).toContain("Provide the changes as a diff when done.");
    expect(fixPromptSchema.safeParse(result).success).toBe(true);
  });

  it("groepeert github-findings per bestandspad", () => {
    const findings = [
      makeFinding({
        id: "g:1",
        check_id: "gitleaks",
        category: "github",
        severity: "critical",
        title: "Leak A",
        evidence: "src/config.js:3",
      }),
      makeFinding({
        id: "g:2",
        check_id: "gitleaks",
        category: "github",
        severity: "high",
        title: "Leak B",
        evidence: "src/config.js:9",
      }),
    ];
    const result = buildScanFixPrompt(findings, { ...SCOPE, githubRepo: "acme/web" });
    expect(result.prompt).toContain("### File: https://github.com/acme/web/blob/main/src/config.js");
    expect(result.prompt).toContain("#### Leak A (Critical)");
    expect(result.prompt).toContain("#### Leak B (High)");
  });

  it("truncateert boven het tokenbudget met 'and N more'", () => {
    const findings = Array.from({ length: 40 }, (_, index) =>
      makeFinding({
        id: `f:${index}`,
        title: `Finding ${index}`,
        severity: index % 2 === 0 ? "critical" : "high",
        description: "d".repeat(120),
        remediation: "r".repeat(80),
      }),
    );
    const result = buildScanFixPrompt(findings, SCOPE);
    expect(result.truncated).toBe(true);
    expect(result.findings_covered).toBeLessThan(findings.length);
    expect(result.prompt).toMatch(/… and \d+ more findings omitted \(token limit\)/);
    expect(estimateTokens(result.prompt)).toBeLessThanOrEqual(FIX_PROMPT_MAX_TOKENS + 5);
    expect(fixPromptSchema.safeParse(result).success).toBe(true);
  });

  it("levert een lege prompt-opstelling voor een scan zonder open findings", () => {
    const result = buildScanFixPrompt(
      [makeFinding({ status: "fixed" }), makeFinding({ status: "ignored" })],
      SCOPE,
    );
    expect(result.findings_covered).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.prompt).toContain("## Findings to fix");
  });
});

describe("severityLabelForPrompt", () => {
  it("mapt severities op Engelse labels", () => {
    expect(severityLabelForPrompt("critical")).toBe("Critical");
    expect(severityLabelForPrompt("info")).toBe("Info");
  });
});