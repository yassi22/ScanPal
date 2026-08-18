import {
  checkById,
  parseRepoSlug,
  parseOsvJson,
  osvEvidence,
  osvStatus,
  type OsvEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { cloneRepo, runSastTool } from "./sast-runner";

const OSV_IMAGE = process.env.OSV_SCANNER_IMAGE ?? "google/osv-scanner:latest";

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Feature 48 — OSV-Scanner dependency-vulnerabilities (category github,
 * site-level). Clonet de repo (shallow), draait `osv-scanner --json --recursive
 * /repo` in een Docker-container met een read-only mount, en normaliseert de
 * JSON via `parseOsvJson`. Status: critical/high → fail, medium/low → warn.
 * OSV-Scanner exit non-zero bij gevonden vulns — runSastTool behandelt dat als
 * ok (stdout bevat de JSON).
 */
export const osvScannerCheck: CheckImplementation = {
  id: "osv-scanner",
  category: "github",
  async run(ctx) {
    const name = checkById("osv-scanner")?.name ?? "OSV-Scanner (deps)";
    const slug = parseRepoSlug(ctx.githubRepo ?? "");
    if (!slug) {
      return [
        {
          id: "osv-scanner",
          name,
          status: "warn",
          detail: "Geen geldig GitHub-repo gekoppeld — OSV-Scanner niet uitgevoerd",
        },
      ];
    }

    const rate = await ctx.rateLimit("osv-scanner:github.com", 10, 60);
    if (!rate.ok) {
      return [
        {
          id: "osv-scanner",
          name,
          status: "warn",
          detail: "Rate-limit bereikt — OSV-Scanner niet uitgevoerd",
        },
      ];
    }

    const cloneUrl = `https://github.com/${slug.owner}/${slug.repo}`;
    const clone = await cloneRepo(cloneUrl);
    if (!clone.ok) {
      return [
        {
          id: "osv-scanner",
          name,
          status: "fail",
          detail: `Repo niet te clonen voor OSV-Scanner: ${clone.error}`,
        },
      ];
    }

    try {
      const res = await runSastTool({
        image: OSV_IMAGE,
        repoDir: clone.dir,
        args: ["--json", "--recursive", "/repo"],
      });
      if (!res.ok) {
        return [
          {
            id: "osv-scanner",
            name,
            status: "warn",
            detail: `OSV-Scanner niet uitvoerbaar: ${res.error}`,
          },
        ];
      }

      const json = parseJsonSafe(res.stdout);
      const vulns = parseOsvJson(json);
      const status = osvStatus(vulns);
      const evidence: OsvEvidence = osvEvidence(vulns);
      const by = evidence.by_severity;

      const detail =
        vulns.length === 0
          ? `${slug.owner}/${slug.repo}: geen bekende dependency-kwetsbaarheden.`
          : `${slug.owner}/${slug.repo}: ${vulns.length} kwetsbaarheid(en) ` +
            `(critical=${by.critical}, high=${by.high}, medium=${by.medium}, low=${by.low}).`;

      return [
        {
          id: "osv-scanner",
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
