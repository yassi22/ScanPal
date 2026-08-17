import { describe, it, expect } from "vitest";
import {
  addSiteInputSchema,
  updateSiteInputSchema,
  onboardingSiteInputSchema,
  canonicalizeSiteUrl,
  canonicalizeGithubRepo,
  detectGithubRepoFromUrl,
} from "@scanpal/shared";

describe("canonicalizeSiteUrl", () => {
  it("stript protocol en www", () => {
    expect(canonicalizeSiteUrl("voorbeeld.nl")).toBe("voorbeeld.nl");
    expect(canonicalizeSiteUrl("https://www.example.com")).toBe("example.com");
    expect(canonicalizeSiteUrl("http://example.com")).toBe("example.com");
  });

  it("maakt de hostname lowercase en houdt het pad", () => {
    expect(canonicalizeSiteUrl("HTTPS://EXAMPLE.COM/Path")).toBe(
      "example.com/Path",
    );
    expect(canonicalizeSiteUrl("https://example.com/foo/")).toBe(
      "example.com/foo",
    );
    expect(canonicalizeSiteUrl("https://example.com?q=1")).toBe(
      "example.com?q=1",
    );
  });

  it("laat niet-standaard poorten staan en laat default poorten vallen", () => {
    expect(canonicalizeSiteUrl("example.com:8080/x")).toBe("example.com:8080/x");
    expect(canonicalizeSiteUrl("example.com:443")).toBe("example.com");
  });

  it("wijst ongeldige input af", () => {
    expect(canonicalizeSiteUrl("localhost")).toBeNull();
    expect(canonicalizeSiteUrl("ftp://example.com")).toBeNull();
    expect(canonicalizeSiteUrl("")).toBeNull();
    expect(canonicalizeSiteUrl("https://user:pass@example.com")).toBeNull();
    expect(canonicalizeSiteUrl("not a url")).toBeNull();
  });

  it("is idempotent op canonieke vorm", () => {
    const canonical = canonicalizeSiteUrl("https://www.example.com/foo")!;
    expect(canonicalizeSiteUrl(canonical)).toBe(canonical);
  });
});

describe("canonicalizeGithubRepo", () => {
  it("normaliseert owner/repo naar lowercase", () => {
    expect(canonicalizeGithubRepo("Owner/Repo")).toBe("owner/repo");
    expect(canonicalizeGithubRepo("o/r")).toBe("o/r");
  });

  it("accepteert github.com-links en .git-suffix", () => {
    expect(canonicalizeGithubRepo("https://github.com/Owner/Repo")).toBe(
      "owner/repo",
    );
    expect(canonicalizeGithubRepo("github.com/o/r")).toBe("o/r");
    expect(canonicalizeGithubRepo("https://www.github.com/o/r.git")).toBe("o/r");
  });

  it("wijst andere domeinen, subpaden en losse namen af", () => {
    expect(canonicalizeGithubRepo("gitlab.com/o/r")).toBeNull();
    expect(canonicalizeGithubRepo("https://gitlab.com/o/r")).toBeNull();
    expect(canonicalizeGithubRepo("https://github.com/o/r/x")).toBeNull();
    expect(canonicalizeGithubRepo("o/r/x")).toBeNull();
    expect(canonicalizeGithubRepo("o")).toBeNull();
    expect(canonicalizeGithubRepo("")).toBeNull();
  });
});

describe("detectGithubRepoFromUrl", () => {
  it("herkent github.com-links (protocol, www, .git)", () => {
    expect(detectGithubRepoFromUrl("https://github.com/Owner/Repo")).toBe(
      "owner/repo",
    );
    expect(detectGithubRepoFromUrl("github.com/o/r")).toBe("o/r");
    expect(detectGithubRepoFromUrl("www.github.com/o/r.git")).toBe("o/r");
  });

  it("herkent een losse owner/repo-string", () => {
    expect(detectGithubRepoFromUrl("Owner/Repo")).toBe("owner/repo");
    expect(detectGithubRepoFromUrl("o/r")).toBe("o/r");
  });

  it("wijst subpaden en andere domeinen af", () => {
    expect(detectGithubRepoFromUrl("https://github.com/o/r/x")).toBeNull();
    expect(detectGithubRepoFromUrl("gitlab.com/o/r")).toBeNull();
  });

  it("laat geldige website-URLs met pad met rust", () => {
    expect(detectGithubRepoFromUrl("example.com/foo")).toBeNull();
    expect(detectGithubRepoFromUrl("https://example.com/foo/bar")).toBeNull();
    expect(detectGithubRepoFromUrl("localhost")).toBeNull();
    expect(detectGithubRepoFromUrl("")).toBeNull();
  });
});

describe("addSiteInputSchema", () => {
  it("accepteert een geldige URL met optionele velden", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "voorbeeld.nl",
      github_repo: "https://github.com/Owner/Repo",
      label: "Mijn site",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepteert lege github_repo en label", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "https://www.example.com",
      github_repo: "",
      label: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("wijst een ongeldige URL af", () => {
    const parsed = addSiteInputSchema.safeParse({ url: "localhost" });
    expect(parsed.success).toBe(false);
  });

  it("wijst een ongeldig GitHub-repo af", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "voorbeeld.nl",
      github_repo: "gitlab.com/o/r",
    });
    expect(parsed.success).toBe(false);
  });

  it("wijst een github.com-repo in het url-veld af met uitleg (repo leeg)", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "github.com/Owner/Repo",
    });
    expect(parsed.success).toBe(false);
    const urlIssue = parsed.error!.issues.find((i) => i.path[0] === "url");
    expect(urlIssue?.message).toBe(
      "GitHub-repo herkend als owner/repo — vul ook een website-URL in",
    );
  });

  it("wijst een github.com-repo in het url-veld ook af met expliciet repo", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "github.com/o/r",
      github_repo: "o/r",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]?.message).toBe(
      "GitHub-repo herkend als o/r — vul ook een website-URL in",
    );
  });

  it("geeft bij een losse owner/repo de bestaande URL-melding", () => {
    const parsed = addSiteInputSchema.safeParse({ url: "owner/repo" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]?.message).toBe(
      "Voer een geldige URL in, bijvoorbeeld https://voorbeeld.nl",
    );
  });

  it("accepteert een geldige website-URL met pad (geen repo-detectie)", () => {
    const parsed = addSiteInputSchema.safeParse({ url: "https://example.com/foo" });
    expect(parsed.success).toBe(true);
  });

  it("wijst een label langer dan 100 tekens af", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "voorbeeld.nl",
      label: "x".repeat(101),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepteert een label van precies 100 tekens", () => {
    const parsed = addSiteInputSchema.safeParse({
      url: "voorbeeld.nl",
      label: "x".repeat(100),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("updateSiteInputSchema", () => {
  it("wijst een lege body af", () => {
    const parsed = updateSiteInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("accepteert label of github_repo (ook om te wissen)", () => {
    expect(updateSiteInputSchema.safeParse({ label: null }).success).toBe(true);
    expect(updateSiteInputSchema.safeParse({ github_repo: "" }).success).toBe(
      true,
    );
    expect(
      updateSiteInputSchema.safeParse({ label: "A", github_repo: "o/r" })
        .success,
    ).toBe(true);
  });
});

describe("onboardingSiteInputSchema", () => {
  it("accepteert een geldige website-URL", () => {
    expect(
      onboardingSiteInputSchema.safeParse({ url: "https://voorbeeld.nl" })
        .success,
    ).toBe(true);
  });

  it("deelt dezelfde detectie: github.com-repo in url → 400-melding", () => {
    const parsed = onboardingSiteInputSchema.safeParse({
      url: "github.com/Owner/Repo",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]?.message).toBe(
      "GitHub-repo herkend als owner/repo — vul ook een website-URL in",
    );
  });

  it("wijst een losse owner/repo af met de bestaande URL-melding", () => {
    const parsed = onboardingSiteInputSchema.safeParse({ url: "owner/repo" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]?.message).toBe(
      "Voer een geldige URL in, bijvoorbeeld https://voorbeeld.nl",
    );
  });
});
