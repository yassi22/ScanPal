import { describe, it, expect, vi, beforeEach } from "vitest";
import { gitleaksCheck } from "../gitleaks";
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

describe("gitleaksCheck (feature 47)", () => {
  it("warn zonder geldig github-repo", async () => {
    const [result] = await gitleaksCheck.run({ ...ctx(), githubRepo: null });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Geen geldig GitHub-repo");
    expect(mockedCloneRepo).not.toHaveBeenCalled();
  });

  it("fail bij gevonden secrets + critical severity override", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify([
        {
          RuleID: "aws-access-key",
          File: "config.js",
          StartLine: 5,
          Match: "AKIAIOSFODNN7EXAMPLE",
          Description: "AWS Access Key",
        },
      ]),
      stderr: "",
      exitCode: 1,
    });
    const [result] = await gitleaksCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(result.severity).toBe("critical");
    expect(result.evidence).toMatchObject({ kind: "gitleaks", total: 1 });
    expect(result.detail).toContain("1 gelekte secret(s)");
  });

  it("pass bij geen secrets", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify([]),
      stderr: "",
      exitCode: 0,
    });
    const [result] = await gitleaksCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("pass");
    expect(result.severity).toBeUndefined();
    expect(result.evidence).toMatchObject({ kind: "gitleaks", total: 0 });
  });

  it("fail als clone faalt", async () => {
    mockedCloneRepo.mockResolvedValue({ ok: false, error: "auth" });
    const [result] = await gitleaksCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(mockedRunSastTool).not.toHaveBeenCalled();
  });

  it("geeft --report-path /dev/stdout door", async () => {
    mockedCloneRepo.mockResolvedValue({
      ok: true,
      dir: fakeDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify([]),
      stderr: "",
      exitCode: 0,
    });
    await gitleaksCheck.run(ctx("owner/repo"));
    const args = mockedRunSastTool.mock.calls[0][0].args;
    expect(args).toContain("--report-path");
    expect(args).toContain("/dev/stdout");
  });

  it("roemt cleanup na de run", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockedCloneRepo.mockResolvedValue({ ok: true, dir: fakeDir, cleanup });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify([]),
      stderr: "",
      exitCode: 0,
    });
    await gitleaksCheck.run(ctx("owner/repo"));
    expect(cleanup).toHaveBeenCalled();
  });
});
