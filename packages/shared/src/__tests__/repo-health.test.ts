import { describe, it, expect } from "vitest";
import {
  parseRepoSlug,
  licenseSignal,
  readmeSignal,
  ciSignal,
  branchProtectionSignal,
  mfaSignal,
  repoHealthOverallStatus,
  repoHealthEvidence,
  repoHealthEvidenceSchema,
  REPO_HEALTH_SIGNALS,
} from "../repo-health";
import { checkCatalog } from "../check-catalog";

describe("repo-health (feature 49)", () => {
  it("heeft de catalog-entry repo-health (categorie github, passief)", () => {
    const entry = checkCatalog.find((c) => c.id === "repo-health");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("github");
    expect(entry?.active).toBe(false);
  });

  it("definieert 5 signalen", () => {
    expect(REPO_HEALTH_SIGNALS).toEqual([
      "branch_protection",
      "license",
      "readme",
      "ci",
      "mfa",
    ]);
  });

  describe("parseRepoSlug", () => {
    it("parseert https github-urls", () => {
      expect(parseRepoSlug("https://github.com/owner/repo")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("strip .git en trailing paden", () => {
      expect(parseRepoSlug("https://github.com/owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
      expect(parseRepoSlug("https://github.com/owner/repo/tree/main")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parseert SSH-form", () => {
      expect(parseRepoSlug("git@github.com:owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("accepteert owner/repo-slug", () => {
      expect(parseRepoSlug("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    });

    it("reject ongeldig", () => {
      expect(parseRepoSlug("")).toBeNull();
      expect(parseRepoSlug("nogithub")).toBeNull();
      expect(parseRepoSlug("https://github.com/onlyowner")).toBeNull();
    });
  });

  describe("licenseSignal", () => {
    it("ok bij herkende licentie", () => {
      const s = licenseSignal({ license: { spdx_id: "MIT" }, default_branch: "main" });
      expect(s.status).toBe("ok");
      expect(s.detail).toContain("MIT");
    });

    it("missing bij license null", () => {
      const s = licenseSignal({ license: null, default_branch: "main" });
      expect(s.status).toBe("missing");
    });
  });

  describe("readmeSignal", () => {
    it("200 → ok, 404 → missing, anders → unknown", () => {
      expect(readmeSignal(200).status).toBe("ok");
      expect(readmeSignal(404).status).toBe("missing");
      expect(readmeSignal(500).status).toBe("unknown");
    });
  });

  describe("ciSignal", () => {
    it("404 → missing", () => {
      expect(ciSignal(404).status).toBe("missing");
    });

    it("200 met array → ok", () => {
      expect(ciSignal(200, [{ name: "ci.yml" }]).status).toBe("ok");
    });

    it("200 met lege array → missing", () => {
      expect(ciSignal(200, []).status).toBe("missing");
    });

    it("andere status → unknown", () => {
      expect(ciSignal(403).status).toBe("unknown");
    });
  });

  describe("branchProtectionSignal", () => {
    it("404 → missing", () => {
      expect(branchProtectionSignal(null, 404).status).toBe("missing");
    });

    it("403 → unknown (geen toegang)", () => {
      expect(branchProtectionSignal(null, 403).status).toBe("unknown");
    });

    it("200 met velden → ok met detail", () => {
      const s = branchProtectionSignal(
        {
          enforce_admins: { enabled: true },
          required_pull_request_reviews: { required_approving_review_count: 2 },
          required_signatures: { enabled: false },
        },
        200,
      );
      expect(s.status).toBe("ok");
      expect(s.detail).toContain("enforce_admins");
      expect(s.detail).toContain("reviews=2");
    });

    it("200 zonder enforce_admins → ok zonder dat detail", () => {
      const s = branchProtectionSignal({ enforce_admins: { enabled: false } }, 200);
      expect(s.status).toBe("ok");
      expect(s.detail).not.toContain("enforce_admins");
    });
  });

  describe("mfaSignal", () => {
    it("ok als branch enforce_admins actief heeft", () => {
      const branch = branchProtectionSignal(
        { enforce_admins: { enabled: true } },
        200,
      );
      expect(mfaSignal(branch).status).toBe("ok");
    });

    it("missing als branch ok zonder enforce_admins", () => {
      const branch = branchProtectionSignal(
        { enforce_admins: { enabled: false } },
        200,
      );
      expect(mfaSignal(branch).status).toBe("missing");
    });

    it("missing als branch niet beveiligd", () => {
      const branch = branchProtectionSignal(null, 404);
      expect(mfaSignal(branch).status).toBe("missing");
    });

    it("unknown als branch unknown", () => {
      const branch = branchProtectionSignal(null, 403);
      expect(mfaSignal(branch).status).toBe("unknown");
    });
  });

  describe("repoHealthOverallStatus", () => {
    const ok = (signal: string): { signal: string; status: "ok"; detail: string } => ({
      signal,
      status: "ok",
      detail: "x",
    }) as never;

    it("fail als branch_protection missing", () => {
      const s = [
        { signal: "branch_protection", status: "missing", detail: "" },
        ok("license"),
        ok("readme"),
        ok("ci"),
        ok("mfa"),
      ] as never;
      expect(repoHealthOverallStatus(s)).toBe("fail");
    });

    it("warn als license missing (rest ok)", () => {
      const s = [
        ok("branch_protection"),
        { signal: "license", status: "missing", detail: "" },
        ok("readme"),
        ok("ci"),
        ok("mfa"),
      ] as never;
      expect(repoHealthOverallStatus(s)).toBe("warn");
    });

    it("warn bij unknown-signal", () => {
      const s = [
        ok("branch_protection"),
        ok("license"),
        { signal: "readme", status: "unknown", detail: "" },
        ok("ci"),
        ok("mfa"),
      ] as never;
      expect(repoHealthOverallStatus(s)).toBe("warn");
    });

    it("pass als alles ok", () => {
      const s = REPO_HEALTH_SIGNALS.map((sig) => ok(sig)) as never;
      expect(repoHealthOverallStatus(s)).toBe("pass");
    });
  });

  describe("repoHealthEvidence", () => {
    it("bouwt geldig evidence-object", () => {
      const ev = repoHealthEvidence("owner", "repo", "main", "public", [
        { signal: "branch_protection", status: "ok", detail: "Beveiligd" },
        { signal: "license", status: "ok", detail: "MIT" },
        { signal: "readme", status: "ok", detail: "README aanwezig" },
        { signal: "ci", status: "missing", detail: "geen" },
        { signal: "mfa", status: "missing", detail: "geen" },
      ]);
      expect(ev.kind).toBe("repo-health");
      expect(ev.owner).toBe("owner");
      expect(ev.signals).toHaveLength(5);
      const parsed = repoHealthEvidenceSchema.safeParse(ev);
      expect(parsed.success).toBe(true);
    });
  });
});
