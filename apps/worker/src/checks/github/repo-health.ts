import {
  checkById,
  branchProtectionSignal,
  ciSignal,
  licenseSignal,
  mfaSignal,
  parseRepoSlug,
  readmeSignal,
  repoHealthEvidence,
  repoHealthOverallStatus,
  type RepoHealthEvidence,
  type RepoHealthSignal,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

const GITHUB_API = "https://api.github.com";

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ScanPal-repo-health",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

type FetchResult = { status: number; json: unknown };

async function githubFetch(path: string, timeoutMs = 8000): Promise<FetchResult> {
  try {
    const res = await fetchPage(`${GITHUB_API}${path}`, {
      timeoutMs,
      headers: authHeaders(),
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

/**
 * Feature 49 — repo-health check (category github, site-level). Haalt de
 * GitHub REST API aan voor branch-protection, LICENSE, README, CI en een
 * MFA-proxy (enforce_admins). Vereist `ctx.githubRepo` (slug of URL);
 * `GITHUB_TOKEN` (env) verhoogt de rate-limit en geeft toegang tot private
 * repo's / branch-protection. Zonder repo → warn (geen github-queue dan ook
 * niet gestart, dus dit is een defensieve check).
 */
export const repoHealthCheck: CheckImplementation = {
  id: "repo-health",
  category: "github",
  async run(ctx) {
    const name = checkById("repo-health")?.name ?? "Repo-health";
    const slug = parseRepoSlug(ctx.githubRepo ?? "");
    if (!slug) {
      return [
        {
          id: "repo-health",
          name,
          status: "warn",
          detail: "Geen geldig GitHub-repo gekoppeld aan de site",
        },
      ];
    }
    const { owner, repo } = slug;

    const rate = await ctx.rateLimit(`repo-health:github.com`, 30, 60);
    if (!rate.ok) {
      return [
        {
          id: "repo-health",
          name,
          status: "warn",
          detail: "Rate-limit bereikt — repo-health niet uitgevoerd",
        },
      ];
    }

    const repoRes = await githubFetch(`/repos/${owner}/${repo}`);
    const repoJson = repoRes.json;
    if (repoRes.status === 404) {
      return [
        {
          id: "repo-health",
          name,
          status: "fail",
          detail: `GitHub-repo ${owner}/${repo} niet gevonden (404)`,
        },
      ];
    }
    if (repoRes.status !== 200 || !repoJson) {
      return [
        {
          id: "repo-health",
          name,
          status: "warn",
          detail: `Repo-metadata niet ophaalbaar (status ${repoRes.status})`,
        },
      ];
    }

    const meta = repoJson as {
      default_branch?: string;
      visibility?: string | null;
    };
    const defaultBranch = meta.default_branch ?? "main";
    const visibility = meta.visibility ?? null;

    const signals: RepoHealthSignal[] = [];
    signals.push(licenseSignal(repoJson));

    const readmeRes = await githubFetch(`/repos/${owner}/${repo}/readme`);
    signals.push(readmeSignal(readmeRes.status));

    const ciRes = await githubFetch(`/repos/${owner}/${repo}/contents/.github/workflows`);
    signals.push(ciSignal(ciRes.status, ciRes.json));

    const protectionRes = await githubFetch(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}/protection`,
    );
    const branch = branchProtectionSignal(protectionRes.json, protectionRes.status);
    signals.push(branch);
    signals.push(mfaSignal(branch));

    const status = repoHealthOverallStatus(signals);
    const evidence: RepoHealthEvidence = repoHealthEvidence(
      owner,
      repo,
      defaultBranch,
      visibility,
      signals,
    );

    const summary = signals
      .map((s) => `${s.signal}=${s.status}`)
      .join(", ");

    return [
      {
        id: "repo-health",
        name,
        status,
        detail: `${owner}/${repo} (branch: ${defaultBranch}) — ${summary}.`,
        evidence,
      },
    ];
  },
};
