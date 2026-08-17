import {
  checkById,
  parseRepoSlug,
  parseSemgrepJson,
  semgrepEvidence,
  semgrepStatus,
  type SemgrepEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { cloneRepo, runSastTool } from "./sast-runner";

const SEMGREP_IMAGE = process.env.SEMGREP_IMAGE ?? "returntocorp/semgrep:latest";

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Feature 46 — Semgrep SAST-scan (category github, site-level). Clonet de
 * repo (shallow), draait `semgrep --json --config auto` in een Docker-container
 * met een read-only mount, en normaliseert de JSON via `parseSemgrepJson`.
 * Status: fail bij high-severity-issues, warn bij medium, anders pass.
 */
export const semgrepCheck: CheckImplementation = {
  id: "semgrep",
  category: "github",
  async run(ctx) {
    const name = checkById("semgrep")?.name ?? "Semgrep (SAST)";
    const slug = parseRepoSlug(ctx.githubRepo ?? "");
    if (!slug) {
      return [
        {
          id: "semgrep",
          name,
          status: "warn",
          detail: "Geen geldig GitHub-repo gekoppeld — Semgrep niet uitgevoerd",
        },
      ];
    }

    const rate = await ctx.rateLimit("semgrep:github.com", 10, 60);
    if (!rate.ok) {
      return [
        {
          id: "semgrep",
          name,
          status: "warn",
          detail: "Rate-limit bereikt — Semgrep niet uitgevoerd",
        },
      ];
    }

    const cloneUrl = `https://github.com/${slug.owner}/${slug.repo}`;
    const clone = await cloneRepo(cloneUrl);
    if (!clone.ok) {
      return [
        {
          id: "semgrep",
          name,
          status: "fail",
          detail: `Repo niet te clonen voor Semgrep: ${clone.error}`,
        },
      ];
    }

    try {
      const res = await runSastTool({
        image: SEMGREP_IMAGE,
        repoDir: clone.dir,
        args: ["semgrep", "--json", "--config", "auto", "/repo"],
      });
      if (!res.ok) {
        return [
          {
            id: "semgrep",
            name,
            status: "warn",
            detail: `Semgrep niet uitvoerbaar: ${res.error}`,
          },
        ];
      }

      const json = parseJsonSafe(res.stdout);
      const issues = parseSemgrepJson(json);
      const status = semgrepStatus(issues);
      const evidence: SemgrepEvidence = semgrepEvidence(issues);
      const by = evidence.by_severity;

      const detail =
        issues.length === 0
          ? `${slug.owner}/${slug.repo}: geen SAST-issues.`
          : `${slug.owner}/${slug.repo}: ${issues.length} issue(s) ` +
            `(high=${by.high}, medium=${by.medium}, low=${by.low}).`;

      return [
        {
          id: "semgrep",
          name,
          status,
          detail,
          evidence,
        },
      ];
    } finally {
      await clone.cleanup();
    }
  },
};
