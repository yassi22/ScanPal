import { describe, it, expect } from "vitest";
import {
  maskMatch,
  parseSemgrepJson,
  semgrepEvidence,
  semgrepStatus,
  parseGitleaksJson,
  gitleaksEvidence,
  gitleaksStatus,
  parseOsvJson,
  cvssToSeverity,
  osvEvidence,
  osvStatus,
  semgrepEvidenceSchema,
  gitleaksEvidenceSchema,
  osvEvidenceSchema,
} from "../sast-findings";

describe("sast-findings (features 46-48)", () => {
  describe("maskMatch", () => {
    it("maskeert langer dan 8 tekens naar 4+4", () => {
      expect(maskMatch("AKIAIOSFODNN7EXAMPLE")).toBe("AKIA…MPLE");
    });
    it("maskeert korte strings (geen volledige secrets in evidence)", () => {
      expect(maskMatch("kort")).toBe("k…");
      expect(maskMatch("12345678")).toBe("1…");
      expect(maskMatch("")).toBe("");
    });
  });

  describe("Semgrep (46)", () => {
    const semgrepJson = {
      results: [
        {
          check_id: "python.eqeq-is-bad",
          path: "app.py",
          start: { line: 12, col: 3 },
          extra: { message: "use == not is", severity: "ERROR" },
        },
        {
          check_id: "generic.warning",
          path: "lib/util.js",
          start: { line: 4 },
          extra: { message: "weak check", severity: "WARNING" },
        },
        {
          check_id: "info.rule",
          path: "x.ts",
          start: {},
          extra: { message: "fyi", severity: "INFO" },
        },
        {
          check_id: "unknown.sev",
          path: "y.ts",
          extra: { message: "onbekend", severity: "WEIRD" },
        },
      ],
    };

    it("parseert results en mapt severities", () => {
      const issues = parseSemgrepJson(semgrepJson);
      expect(issues).toHaveLength(4);
      expect(issues[0]).toEqual({
        check_id: "python.eqeq-is-bad",
        path: "app.py",
        line: 12,
        message: "use == not is",
        severity: "high",
      });
      expect(issues[1].severity).toBe("medium");
      expect(issues[2].severity).toBe("low");
      expect(issues[3].severity).toBe("medium"); // fallback
    });

    it("negeert ongeldige input", () => {
      expect(parseSemgrepJson(null)).toEqual([]);
      expect(parseSemgrepJson({})).toEqual([]);
      expect(parseSemgrepJson({ results: "geen-array" })).toEqual([]);
    });

    it("semgrepStatus: high→fail, medium→warn, leeg→pass", () => {
      expect(semgrepStatus(parseSemgrepJson(semgrepJson))).toBe("fail");
      expect(semgrepStatus(parseSemgrepJson({ results: [] }))).toBe("pass");
      expect(
        semgrepStatus(parseSemgrepJson({ results: [{ check_id: "x", path: "y", extra: { severity: "WARNING" } }] })),
      ).toBe("warn");
    });

    it("semgrepEvidence telt per severity + valideert", () => {
      const issues = parseSemgrepJson(semgrepJson);
      const ev = semgrepEvidence(issues);
      expect(ev.kind).toBe("semgrep");
      expect(ev.total).toBe(4);
      expect(ev.by_severity).toEqual({ high: 1, medium: 2, low: 1 });
      expect(ev.samples).toHaveLength(4);
      expect(semgrepEvidenceSchema.safeParse(ev).success).toBe(true);
    });

    it("capteert semgrep-samples op 10", () => {
      const many = Array.from({ length: 15 }, (_, i) => ({
        check_id: `r${i}`,
        path: "f",
        line: i,
        message: "m",
        severity: "high" as const,
      }));
      expect(semgrepEvidence(many).samples).toHaveLength(10);
    });
  });

  describe("Gitleaks (47)", () => {
    const gitleaksJson = [
      {
        RuleID: "aws-access-key",
        File: "config.js",
        StartLine: 5,
        Match: "AKIAIOSFODNN7EXAMPLE",
        Description: "AWS Access Key",
      },
      {
        RuleID: "github-pat",
        File: ".env",
        StartLine: 1,
        Secret: "ghp_SHORT",
        Description: "GitHub PAT",
      },
    ];

    it("parseert + maskeert match", () => {
      const issues = parseGitleaksJson(gitleaksJson);
      expect(issues).toHaveLength(2);
      expect(issues[0].match_preview).toBe("AKIA…MPLE");
      expect(issues[1].match_preview).toBe("ghp_…HORT"); // 9 tekens → gemaskeerd
      expect(issues[1].file).toBe(".env");
    });

    it("gitleaksStatus: >0 → fail, leeg → pass", () => {
      expect(gitleaksStatus(parseGitleaksJson(gitleaksJson))).toBe("fail");
      expect(gitleaksStatus([])).toBe("pass");
    });

    it("gitleaksEvidence valideert", () => {
      const ev = gitleaksEvidence(parseGitleaksJson(gitleaksJson));
      expect(ev.total).toBe(2);
      expect(gitleaksEvidenceSchema.safeParse(ev).success).toBe(true);
    });
  });

  describe("OSV-Scanner (48)", () => {
    it("cvssToSeverity mapped scores", () => {
      expect(cvssToSeverity(9.5)).toBe("critical");
      expect(cvssToSeverity(8)).toBe("high");
      expect(cvssToSeverity(5)).toBe("medium");
      expect(cvssToSeverity(2)).toBe("low");
    });

    const osvJson = {
      results: [
        {
          package: { name: "lodash", ecosystem: "npm" },
          version: "4.17.20",
          vulnerabilities: [
            {
              id: "GHSA-xxxx",
              summary: "proto pollution",
              severity: [{ type: "CVSS_V3", score: 7.5 }],
            },
            {
              id: "CVE-2021-1",
              summary: "rce",
              database_specific: { severity: "CRITICAL" },
            },
          ],
        },
      ],
    };

    it("parseert + kiest worst severity", () => {
      const vulns = parseOsvJson(osvJson);
      expect(vulns).toHaveLength(2);
      expect(vulns[0].package_name).toBe("lodash");
      expect(vulns[0].severity).toBe("high"); // 7.5 → high
      expect(vulns[1].severity).toBe("critical"); // database_specific CRITICAL
    });

    it("osvStatus: critical→fail, medium→warn, leeg→pass", () => {
      expect(osvStatus(parseOsvJson(osvJson))).toBe("fail");
      expect(
        osvStatus([
          { id: "x", package_name: "p", ecosystem: "npm", version: "1", summary: "", severity: "medium" },
        ]),
      ).toBe("warn");
      expect(osvStatus([])).toBe("pass");
    });

    it("osvEvidence telt per severity + valideert", () => {
      const ev = osvEvidence(parseOsvJson(osvJson));
      expect(ev.total).toBe(2);
      expect(ev.by_severity).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
      expect(osvEvidenceSchema.safeParse(ev).success).toBe(true);
    });

    it("fallback severity = medium bij geen score", () => {
      const v = parseOsvJson({
        results: [
          {
            package: { name: "p", ecosystem: "npm" },
            version: "1",
            vulnerabilities: [{ id: "CVE-x", summary: "" }],
          },
        ],
      });
      expect(v[0].severity).toBe("medium");
    });
  });
});
