import { describe, it, expect, vi, beforeEach } from "vitest";
import { osvScannerCheck } from "../osv-scanner";
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

describe("osvScannerCheck (feature 48)", () => {
  it("warn zonder geldig github-repo", async () => {
    const [result] = await osvScannerCheck.run({ ...ctx(), githubRepo: null });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Geen geldig GitHub-repo");
    expect(mockedCloneRepo).not.toHaveBeenCalled();
  });

  it("fail bij critical/high vulns", async () => {
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
            package: { name: "lodash", ecosystem: "npm" },
            version: "4.17.20",
            vulnerabilities: [
              {
                id: "CVE-2021-1",
                summary: "rce",
                database_specific: { severity: "CRITICAL" },
              },
            ],
          },
        ],
      }),
      stderr: "",
      exitCode: 1,
    });
    const [result] = await osvScannerCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatchObject({
      kind: "osv-scanner",
      total: 1,
      by_severity: expect.objectContaining({ critical: 1 }),
    });
    expect(result.detail).toContain("1 kwetsbaarheid(en)");
  });

  it("warn bij medium/low vulns", async () => {
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
            package: { name: "p", ecosystem: "npm" },
            version: "1.0.0",
            vulnerabilities: [
              {
                id: "CVE-med",
                summary: "low-sev issue",
                severity: [{ type: "CVSS_V3", score: 4.2 }],
              },
            ],
          },
        ],
      }),
      stderr: "",
      exitCode: 1,
    });
    const [result] = await osvScannerCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatchObject({
      by_severity: expect.objectContaining({ medium: 1 }),
    });
  });

  it("pass bij geen vulns", async () => {
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
    const [result] = await osvScannerCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatchObject({ kind: "osv-scanner", total: 0 });
    expect(result.detail).toContain("geen bekende dependency-kwetsbaarheden");
  });

  it("fail als clone faalt", async () => {
    mockedCloneRepo.mockResolvedValue({ ok: false, error: "auth" });
    const [result] = await osvScannerCheck.run(ctx("owner/repo"));
    expect(result.status).toBe("fail");
    expect(mockedRunSastTool).not.toHaveBeenCalled();
  });

  it("geeft --json + --recursive + /repo door", async () => {
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
    await osvScannerCheck.run(ctx("owner/repo"));
    const args = mockedRunSastTool.mock.calls[0][0].args;
    expect(args).toContain("--json");
    expect(args).toContain("--recursive");
    expect(args).toContain("/repo");
  });

  it("roemt cleanup na de run", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockedCloneRepo.mockResolvedValue({ ok: true, dir: fakeDir, cleanup });
    mockedRunSastTool.mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({ results: [] }),
      stderr: "",
      exitCode: 0,
    });
    await osvScannerCheck.run(ctx("owner/repo"));
    expect(cleanup).toHaveBeenCalled();
  });
});
