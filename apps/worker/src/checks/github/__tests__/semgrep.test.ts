import { describe, it, expect, vi, beforeEach } from "vitest";
import { semgrepCheck } from "../semgrep";
import { cloneRepo, runSastTool } from "../sast-runner";

vi.mock("../sast-runner", () => ({
  cloneRepo: vi.fn(),
  runSastTool: vi.fn(),
}));

const mockedCloneRepo = vi.mocked(cloneRepo);
const mockedRunSastTool = vi.mocked(runSastTool);

function ctx(githubRepo: string | null = "owner/repo") {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    githubRepo,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
  };
}

const fakeDir = "/tmp/fake-repo";

beforeEach(() => {
  mockedCloneRepo.mockReset();
  mockedRunSastTool.mockReset();
});

describe("semgrepCheck (feature 46)", () => {
  it("warn zonder geldig github-repo", async () => {
    const [result] = await semgrepCheck.run({ ...ctx(), githubRepo: null });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Geen geldig GitHub-repo");
    expect(mockedCloneRepo).not.toHaveBeenCalled();
  });

  it("fail als clone faalt", async () => {
    mockedCloneRepo.mockResolvedValue({ ok: false, error: "auth failed" });
    const [result] = await semgrepCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("niet te clonen");
    expect(mockedRunSastTool).not.toHaveBeenCalled();
  });

  it("warn als de tool niet uitvoerbaar is (docker error)", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({ ok: false, error: "docker not found" });
    const [result] = await semgrepCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("niet uitvoerbaar");
  });

  it("fail bij high-severity Semgrep-issues", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({
        results: [
          {
            check_id: "python.eqeq-is-bad",
            path: "app.py",
            start: { line: 12 },
            extra: { message: "use == not is", severity: "ERROR" },
          },
          {
            check_id: "generic.warn",
            path: "lib/x.js",
            start: { line: 3 },
            extra: { message: "weak", severity: "WARNING" },
          },
        ],
      }),
      stderr: "",
      exitCode: 1,
    });
    const [result] = await semgrepCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "semgrep",
      total: 2,
      by_severity: { high: 1, medium: 1, low: 0 },
    });
    expect(result.detail).toContain("2 issue(s)");
  });

  it("pass bij geen issues", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({ results: [] }),
      stderr: "",
      exitCode: 0,
    });
    const [result] = await semgrepCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "semgrep", total: 0 });
    expect(result.detail).toContain("geen SAST-issues");
  });

  it("geeft de repo-mount read-only door aan runSastTool", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({ results: [] }),
      stderr: "",
      exitCode: 0,
    });
    await semgrepCheck.run(ctx("owner/repo"));
    expect(mockedRunSastTool).toHaveBeenCalledWith(
      expect.objectContaining({ repoDir: fakeDir, image: expect.any(String) }),
    );
    expect(mockedRunSastTool.mock.calls[0][0].args).toContain("/repo");
  });

  it("roemt cleanup na de run (ook bij fout)", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockedCloneRepo.mockResolvedValue({ ok: true, dir: fakeDir, cleanup });
    mockedRunSastTool.mockResolvedValue({ ok: false, error: "boom" });
    await semgrepCheck.run(ctx("owner/repo"));
    expect(cleanup).toHaveBeenCalled();
  });
});
