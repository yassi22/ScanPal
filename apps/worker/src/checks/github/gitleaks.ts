import {
  checkById,
  parseRepoSlug,
  parseGitleaksJson,
  gitleaksEvidence,
  gitleaksStatus,
  type GitleaksEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { cloneRepo, runSastTool } from "./sast-runner";

const GITLEAKS_IMAGE = process.env.GITLEAKS_IMAGE ?? "zricethezav/gitleaks:latest";

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Feature 47 — Gitleaks secrets-scan (category github, site-level). Clonet de
 * repo (shallow), draait `gitleaks detect --source /repo --report-format json
 * --report-path /dev/stdout` in een Docker-container met een read-only mount,
 * en normaliseert de JSON-array via `parseGitleaksJson`. Elke gelekte secret →
 * fail (critical severity). Match-previews worden gemaskeerd (4+4).
 */
export const gitleaksCheck: CheckImplementation = {
  id: "gitleaks",
  category: "github",
  async run(ctx) {
    const name = checkById("gitleaks")?.name ?? "Gitleaks (secrets)";
    const slug = parseRepoSlug(ctx.githubRepo ?? "");
    if (!slug) {
      return [
        {
          id: "gitleaks",
          name,
          status: "warn",
          detail: "Geen geldig GitHub-repo gekoppeld — Gitleaks niet uitgevoerd",
        },
      ];
    }

    const rate = await ctx.rateLimit("gitleaks:github.com", 10, 60);
    if (!rate.ok) {
      return [
        {
          id: "gitleaks",
          name,
          status: "warn",
          detail: "Rate-limit bereikt — Gitleaks niet uitgevoerd",
        },
      ];
    }

    const cloneUrl = `https://github.com/${slug.owner}/${slug.repo}`;
    const clone = await cloneRepo(cloneUrl);
    if (!clone.ok) {
      return [
        {
          id: "gitleaks",
          name,
          status: "fail",
          detail: `Repo niet te clonen voor Gitleaks: ${clone.error}`,
        },
      ];
    }

    try {
      const res = await runSastTool({
        image: GITLEAKS_IMAGE,
        repoDir: clone.dir,
        args: [
          "detect",
          "--source",
          "/repo",
          "--report-format",
          "json",
          "--report-path",
          "/dev/stdout",
          "--no-banner",
        ],
      });
      if (!res.ok) {
        return [
          {
            id: "gitleaks",
            name,
            status: "warn",
            detail: `Gitleaks niet uitvoerbaar: ${res.error}`,
          },
        ];
      }

      const json = parseJsonSafe(res.stdout);
      const issues = parseGitleaksJson(json);
      const status = gitleaksStatus(issues);
      const evidence: GitleaksEvidence = gitleaksEvidence(issues);

      const detail =
        issues.length === 0
          ? `${slug.owner}/${slug.repo}: geen gelekte secrets.`
          : `${slug.owner}/${slug.repo}: ${issues.length} gelekte secret(s) gevonden.`;

      // Gitleaks-lekken zijn critical — override severity op de finding.
      return [
        {
          id: "gitleaks",
          name,
          status,
          detail,
          evidence,
          severity: issues.length > 0 ? "critical" : undefined,
        },
      ];
    } finally {
      await clone.cleanup();
    }
  },
};
