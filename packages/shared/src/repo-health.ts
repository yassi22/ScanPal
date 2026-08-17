import { z } from "zod";

/**
 * Feature 49 — repo-health check (category github). Puur logica; de worker-
 * wrapper in `apps/worker/src/checks/github/repo-health.ts` haalt de GitHub
 * REST API aan en voert de ruwe responses aan deze helpers.
 *
 * Signalen (besluit: 5 velden, conform feature-omschrijving):
 * - branch_protection: default branch beveiligd (+ enforce_admins / required
 *   reviews / required signatures waar zichtbaar).
 * - license: LICENSE-bestand aanwezig (uit de repo-metadata).
 * - readme: README aanwezig (aparte contents-call).
 * - ci: .github/workflows-directory met workflows.
 * - mfa: heuristiek — GitHub stelt org-MFA niet beschikbaar via de repo-API
 *   zonder org-admin scope. We gebruiken `enforce_admins` (regels gelden ook
 *   voor admins) als proxy voor uniforme afdwinging; zonder branch-protection-
 *   toegang is het signaal `unknown`.
 */

export const REPO_HEALTH_SIGNALS = [
  "branch_protection",
  "license",
  "readme",
  "ci",
  "mfa",
] as const;
export type RepoHealthSignalName = (typeof REPO_HEALTH_SIGNALS)[number];

export type RepoHealthSignalStatus = "ok" | "missing" | "unknown";

export type RepoHealthSignal = {
  signal: RepoHealthSignalName;
  status: RepoHealthSignalStatus;
  detail: string;
};

export const repoHealthSignalSchema = z.object({
  signal: z.enum(REPO_HEALTH_SIGNALS),
  status: z.enum(["ok", "missing", "unknown"]),
  detail: z.string(),
});
export type RepoHealthSignalParsed = z.infer<typeof repoHealthSignalSchema>;

export const repoHealthEvidenceSchema = z.object({
  kind: z.literal("repo-health"),
  owner: z.string(),
  repo: z.string(),
  default_branch: z.string(),
  visibility: z.string().nullable(),
  signals: z.array(repoHealthSignalSchema),
});
export type RepoHealthEvidence = z.infer<typeof repoHealthEvidenceSchema>;

/**
 * Parseert een GitHub-repo-URL of `owner/repo`-slug naar `{owner, repo}`.
 * Accepteert `https://github.com/owner/repo[.git][/...]`, `git@github.com:owner/repo.git`
 * en `owner/repo`. Returnt `null` bij een ongeldig formaat.
 */
export function parseRepoSlug(input: string): { owner: string; repo: string } | null {
  if (!input || !input.trim()) return null;
  let s = input.trim();

  // SSH-form: git@github.com:owner/repo.git
  const ssh = s.match(/^[\w.-]+@[\w.-]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  // Strip protocol + host
  s = s.replace(/^https?:\/\/([^/]+)\//, "");
  // Strip git@host: al behandeld; strip trailing .git / /stuff
  s = s.replace(/\.git$/, "").replace(/\/$/, "");
  // Alleen owner/repo overhouden (haal trailing pad-segmenten weg → 2 segments)
  const parts = s.split("/");
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) return null;
  return { owner, repo };
}

type RepoMeta = {
  license: unknown;
  default_branch: string;
  visibility?: string | null;
};

/**
 * LICENSE-signaal uit de repo-metadata. GitHub retourneert `license: null`
 * wanneer er geen detecteerbare LICENSE is (of de repo is leeg). Andere velden
 * (key/spdx_id/name) zijn aanwezig bij een herkende licentie.
 */
export function licenseSignal(repoJson: unknown): RepoHealthSignal {
  const meta = repoJson as RepoMeta;
  if (meta && meta.license && typeof meta.license === "object" && "spdx_id" in meta.license) {
    const spdx = (meta.license as { spdx_id?: string | null }).spdx_id;
    return {
      signal: "license",
      status: "ok",
      detail: spdx ? `Licentie: ${spdx}` : "Licentie aanwezig",
    };
  }
  return {
    signal: "license",
    status: "missing",
    detail: "Geen LICENSE-bestand gedetecteerd",
  };
}

/**
 * README-signaal op basis van de HTTP-status van
 * `GET /repos/{owner}/{repo}/readme` (200 = aanwezig, 404 = afwezig).
 */
export function readmeSignal(statusCode: number): RepoHealthSignal {
  if (statusCode === 200) {
    return { signal: "readme", status: "ok", detail: "README aanwezig" };
  }
  if (statusCode === 404) {
    return { signal: "readme", status: "missing", detail: "Geen README gevonden" };
  }
  return { signal: "readme", status: "unknown", detail: `README-call status ${statusCode}` };
}

/**
 * CI-signaal op basis van de HTTP-status van
 * `GET /repos/{owner}/{repo}/contents/.github/workflows` (200 = directory met
 * bestanden, 404 = geen CI-configuratie).
 */
export function ciSignal(statusCode: number, contentsJson?: unknown): RepoHealthSignal {
  if (statusCode === 404) {
    return { signal: "ci", status: "missing", detail: "Geen .github/workflows-directory" };
  }
  if (statusCode !== 200) {
    return { signal: "ci", status: "unknown", detail: `CI-call status ${statusCode}` };
  }
  const count = Array.isArray(contentsJson) ? contentsJson.length : 0;
  return {
    signal: "ci",
    status: count > 0 ? "ok" : "missing",
    detail: count > 0 ? `${count} workflow-bestand(en)` : "Workflows-directory is leeg",
  };
}

type BranchProtection = {
  enforce_admins?: { enabled?: boolean } | null;
  required_pull_request_reviews?: { required_approving_review_count?: number } | null;
  required_signatures?: { enabled?: boolean } | null;
};

/**
 * Branch-protection-signaal. `protectionJson === null` met `statusCode === 404`
 * = niet beveiligd. `403` = geen toegang (private repo / onvoldoende scope) →
 * `unknown`. Een 200-response met velden geeft detail per sub-regel.
 */
export function branchProtectionSignal(
  protectionJson: unknown,
  statusCode: number,
): RepoHealthSignal {
  if (statusCode === 403 || statusCode === 401) {
    return {
      signal: "branch_protection",
      status: "unknown",
      detail: "Geen toegang tot branch-protection (private repo of scope ontbreekt)",
    };
  }
  if (statusCode === 404 || protectionJson === null) {
    return {
      signal: "branch_protection",
      status: "missing",
      detail: "Default branch is niet beveiligd",
    };
  }
  const p = protectionJson as BranchProtection;
  const parts: string[] = [];
  const enforceAdmins = p.enforce_admins?.enabled === true;
  const reviews = p.required_pull_request_reviews;
  const sigs = p.required_signatures?.enabled === true;
  if (enforceAdmins) parts.push("enforce_admins");
  if (reviews) {
    const n = reviews.required_approving_review_count ?? 0;
    parts.push(`reviews=${n}`);
  }
  if (sigs) parts.push("signed-commits");
  return {
    signal: "branch_protection",
    status: "ok",
    detail: parts.length > 0 ? `Beveiligd (${parts.join(", ")})` : "Beveiligd",
  };
}

/**
 * MFA-heuristiek (besluit: proxy via `enforce_admins` — regels gelden ook voor
 * admins = uniforme afdwinging). Zonder branch-protection-toegang: `unknown`.
 */
export function mfaSignal(branch: RepoHealthSignal): RepoHealthSignal {
  if (branch.status === "unknown") {
    return {
      signal: "mfa",
      status: "unknown",
      detail: "MFA niet bepaalbaar (geen branch-protection-toegang)",
    };
  }
  if (branch.status === "missing") {
    return {
      signal: "mfa",
      status: "missing",
      detail: "Geen branch-protection → geen enforce_admins (MFA-proxy negatief)",
    };
  }
  const enforced = branch.detail.includes("enforce_admins");
  return {
    signal: "mfa",
    status: enforced ? "ok" : "missing",
    detail: enforced
      ? "enforce_admins actief (regels gelden ook voor admins)"
      : "enforce_admins niet actief (regels gelden niet voor admins)",
  };
}

/**
 * Overall repo-health-status uit de signalen (besluit):
 * - fail als branch_protection missing (onbeveiligde default branch = kritiek).
 * - warn als license/readme/ci/mfa missing of unknown.
 * - pass als alles ok.
 */
export function repoHealthOverallStatus(signals: RepoHealthSignal[]): "pass" | "warn" | "fail" {
  const byName = new Map(signals.map((s) => [s.signal, s]));
  const branch = byName.get("branch_protection");
  if (branch?.status === "missing") return "fail";
  const hasIssue = signals.some(
    (s) => s.status === "missing" && s.signal !== "branch_protection",
  );
  const hasUnknown = signals.some((s) => s.status === "unknown");
  if (hasIssue) return "warn";
  if (hasUnknown) return "warn";
  return "pass";
}

export function repoHealthEvidence(
  owner: string,
  repo: string,
  defaultBranch: string,
  visibility: string | null,
  signals: RepoHealthSignal[],
): RepoHealthEvidence {
  return {
    kind: "repo-health",
    owner,
    repo,
    default_branch: defaultBranch,
    visibility,
    signals,
  };
}
