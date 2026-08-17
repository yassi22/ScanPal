import { describe, it, expect, vi, beforeEach } from "vitest";
import { repoHealthCheck } from "../repo-health";
import { fetchPage } from "../../types";

vi.mock("../../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../types")>();
  return { ...actual, fetchPage: vi.fn() };
});

const mockedFetchPage = vi.mocked(fetchPage);

function ctx(githubRepo: string | null = "https://github.com/owner/repo") {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    githubRepo,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockedFetchPage.mockReset();
});

describe("repoHealthCheck (feature 49)", () => {
  it("warn zonder geldig github-repo", async () => {
    const [result] = await repoHealthCheck.run({ ...ctx(null), githubRepo: null });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Geen geldig GitHub-repo");
    expect(result.evidence).toBeUndefined();
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });

  it("fail bij 404 (repo niet gevonden)", async () => {
    mockedFetchPage.mockResolvedValue(jsonResponse(404, { message: "Not Found" }));
    const [result] = await repoHealthCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("niet gevonden");
  });

  it("pass: beveiligde repo met alles in orde", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/repos/owner/repo")) {
        return Promise.resolve(
          jsonResponse(200, {
            default_branch: "main",
            visibility: "public",
            license: { spdx_id: "MIT" },
          }),
        );
      }
      if (url.endsWith("/repos/owner/repo/readme")) {
        return Promise.resolve(jsonResponse(200, { name: "README.md" }));
      }
      if (url.endsWith("/repos/owner/repo/contents/.github/workflows")) {
        return Promise.resolve(jsonResponse(200, [{ name: "ci.yml" }]));
      }
      if (url.endsWith("/repos/owner/repo/branches/main/protection")) {
        return Promise.resolve(
          jsonResponse(200, {
            enforce_admins: { enabled: true },
            required_pull_request_reviews: { required_approving_review_count: 1 },
            required_signatures: { enabled: false },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const [result] = await repoHealthCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "repo-health", owner: "owner", repo: "repo" });
    expect(result.detail).toContain("owner/repo");
  });

  it("fail: default branch niet beveiligd", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/repos/owner/repo")) {
        return Promise.resolve(
          jsonResponse(200, {
            default_branch: "main",
            visibility: "public",
            license: { spdx_id: "MIT" },
          }),
        );
      }
      if (url.endsWith("/repos/owner/repo/readme")) {
        return Promise.resolve(jsonResponse(200, { name: "README.md" }));
      }
      if (url.endsWith("/repos/owner/repo/contents/.github/workflows")) {
        return Promise.resolve(jsonResponse(200, [{ name: "ci.yml" }]));
      }
      // protection 404 = niet beveiligd
      if (url.endsWith("/repos/owner/repo/branches/main/protection")) {
        return Promise.resolve(jsonResponse(404, { message: "Branch not protected" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const [result] = await repoHealthCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      signals: expect.arrayContaining([
        expect.objectContaining({ signal: "branch_protection", status: "missing" }),
      ]),
    });
  });

  it("warn: license + readme + ci missing (branch wel beveiligd)", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/repos/owner/repo")) {
        return Promise.resolve(
          jsonResponse(200, {
            default_branch: "main",
            visibility: "public",
            license: null,
          }),
        );
      }
      if (url.endsWith("/repos/owner/repo/readme")) {
        return Promise.resolve(jsonResponse(404, {}));
      }
      if (url.endsWith("/repos/owner/repo/contents/.github/workflows")) {
        return Promise.resolve(jsonResponse(404, {}));
      }
      if (url.endsWith("/repos/owner/repo/branches/main/protection")) {
        return Promise.resolve(
          jsonResponse(200, { enforce_admins: { enabled: true } }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const [result] = await repoHealthCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatchObject({
      signals: expect.arrayContaining([
        expect.objectContaining({ signal: "license", status: "missing" }),
        expect.objectContaining({ signal: "readme", status: "missing" }),
        expect.objectContaining({ signal: "ci", status: "missing" }),
      ]),
    });
  });

  it("warn: rate-limit bereikt slaat check over", async () => {
    const rateLimitedCtx = {
      ...ctx(),
      rateLimit: vi.fn().mockResolvedValue({ ok: false }) as never,
    };
    const [result] = await repoHealthCheck.run(rateLimitedCtx);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Rate-limit");
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });

  it("gebruikt default branch uit repo-metadata voor protection-call", async () => {
    mockedFetchPage.mockImplementation((url: string) => {
      if (url.endsWith("/repos/owner/repo")) {
        return Promise.resolve(
          jsonResponse(200, {
            default_branch: "develop",
            visibility: "public",
            license: { spdx_id: "MIT" },
          }),
        );
      }
      if (url.endsWith("/repos/owner/repo/readme")) {
        return Promise.resolve(jsonResponse(200, {}));
      }
      if (url.endsWith("/repos/owner/repo/contents/.github/workflows")) {
        return Promise.resolve(jsonResponse(200, [{ name: "ci.yml" }]));
      }
      if (url.endsWith("/repos/owner/repo/branches/develop/protection")) {
        return Promise.resolve(jsonResponse(200, { enforce_admins: { enabled: true } }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const [result] = await repoHealthCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("pass");
    // de protection-call moet naar /branches/develop/ zijn gegaan
    const protectionCall = mockedFetchPage.mock.calls.find((c) =>
      String(c[0]).includes("/branches/develop/protection"),
    );
    expect(protectionCall).toBeDefined();
  });
});
