import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthCredentials,
  UploadFlowCapture,
  UploadFlowRunResult,
  UploadProbeResult,
} from "@scanpal/shared";
import { createFileUploadCheck } from "../file-upload";
import type { BrowserRunner } from "../runner";
import type { CheckContext } from "../../types";

const CREDENTIALS: AuthCredentials = {
  login_url: "https://example.com/login",
  username: "tester@example.com",
  password: "disposable-pass",
};

function ctx(over: Partial<CheckContext> = {}): CheckContext {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: true,
    ownershipVerified: true,
    authCredentials: CREDENTIALS,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
    ...over,
  };
}

function makeRunner(result: UploadFlowRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureStorage: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureClientDeps: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureAuthFlow: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureUploadFlow: vi.fn().mockResolvedValue(result),
  };
}

function probe(over: Partial<UploadProbeResult> = {}): UploadProbeResult {
  return {
    probe_id: "upload-unrestricted-type",
    filename: "shell.php",
    content_type: "image/jpeg",
    active_type: true,
    accepted: false,
    stored_url: null,
    retrieved: false,
    executed: false,
    retrieved_body: "",
    status: 415,
    ...over,
  };
}

function capture(over: Partial<UploadFlowCapture> = {}): UploadFlowCapture {
  return {
    forms: [{ url: "https://example.com/upload", https: true, behind_login: false, accept_attribute: null }],
    probes: [
      probe(),
      probe({ probe_id: "upload-content-sniff", filename: "xss.svg", content_type: "image/svg+xml" }),
      probe({ probe_id: "upload-size-limit", filename: "big.bin", content_type: "application/octet-stream", active_type: false }),
      probe({ probe_id: "upload-path-traversal", filename: "../canary.txt", content_type: "text/plain", active_type: false }),
    ],
    leftover_files: [],
    cleaned_up: true,
    errors: [],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createFileUploadCheck — gating", () => {
  it("retourneert [] wanneer activeTests uit staat", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const result = await createFileUploadCheck(runner).run(ctx({ activeTests: false }));
    expect(result).toEqual([]);
    expect(runner.captureUploadFlow).not.toHaveBeenCalled();
  });

  it("slaat zonder live ownership over met vijf actieve info-findings", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const result = await createFileUploadCheck(runner).run(ctx({ ownershipVerified: false }));
    expect(result).toHaveLength(5);
    expect(result.every((finding) => finding.status === "info" && finding.active === true)).toBe(true);
    expect(result[0]!.detail).toContain("eigendom");
    expect(runner.captureUploadFlow).not.toHaveBeenCalled();
  });

  it("scant publieke formulieren zonder credentials", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const result = await createFileUploadCheck(runner).run(ctx({ authCredentials: null }));
    expect(result).toHaveLength(5);
    expect(runner.captureUploadFlow).toHaveBeenCalledWith("https://example.com/", null);
    expect(result[0]!.detail).not.toContain("overgeslagen");
  });

  it("geeft credentials ongewijzigd aan de runner door", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    await createFileUploadCheck(runner).run(ctx());
    expect(runner.captureUploadFlow).toHaveBeenCalledWith("https://example.com/", CREDENTIALS);
  });

  it("slaat over bij rate-limit of capture-fout", async () => {
    const rateLimit = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const limitedRunner = makeRunner({ ok: true, capture: capture() });
    const limited = await createFileUploadCheck(limitedRunner).run(ctx({ rateLimit: rateLimit as never }));
    expect(limited.every((finding) => finding.status === "info")).toBe(true);
    expect(limited[0]!.detail).toContain("30s");
    expect(limitedRunner.captureUploadFlow).not.toHaveBeenCalled();

    const failed = await createFileUploadCheck(makeRunner({ ok: false, error: "timeout" })).run(ctx());
    expect(failed).toHaveLength(5);
    expect(failed[0]!.detail).toContain("timeout");
  });
});

describe("createFileUploadCheck — interpretatie", () => {
  it("rapporteert vijf info-findings wanneer geen formulier is gevonden", async () => {
    const runner = makeRunner({ ok: true, capture: capture({ forms: [], probes: [] }) });
    const result = await createFileUploadCheck(runner).run(ctx());
    expect(result).toHaveLength(5);
    expect(result.every((finding) => finding.status === "info" && finding.active === true)).toBe(true);
    expect(result[0]!.detail).toContain("Geen upload-formulieren");
  });

  it("kiest per check de ernstigste observatie en laat low geen high overschrijven", async () => {
    const token = "a".repeat(32);
    const runner = makeRunner({
      ok: true,
      capture: capture({
        forms: [{ url: "https://example.com/upload", https: true, behind_login: false, accept_attribute: "image/*" }],
        probes: [
          probe({ accepted: true, stored_url: "/low.php", retrieved: false }),
          probe({ accepted: true, stored_url: "/shell.php", retrieved: true, executed: true, retrieved_body: token }),
          probe({ probe_id: "upload-content-sniff", filename: "xss.svg", content_type: "image/svg+xml", accepted: true, stored_url: "/xss.svg", retrieved: true, retrieved_body: `<svg>${token}</svg>` }),
          probe({ probe_id: "upload-size-limit", filename: "big.bin", content_type: "application/octet-stream", active_type: false, accepted: true, stored_url: "/big.bin" }),
          probe({ probe_id: "upload-path-traversal", filename: "../canary.txt", content_type: "text/plain", active_type: false }),
        ],
      }),
    });
    const result = await createFileUploadCheck(runner).run(ctx());
    expect(result.find((finding) => finding.id === "upload-unrestricted-type")?.severity).toBe("high");
    expect(result.find((finding) => finding.id === "upload-executable")?.status).toBe("fail");
    expect(result.find((finding) => finding.id === "upload-content-sniff")?.severity).toBe("high");
    expect(result.find((finding) => finding.id === "upload-size-limit")?.severity).toBe("medium");
    expect(result.find((finding) => finding.id === "upload-path-traversal")?.status).toBe("pass");
  });

  it("behoudt low als severity bij alleen client-side filtering", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        forms: [{ url: "https://example.com/upload", https: true, behind_login: false, accept_attribute: "image/png" }],
        probes: [probe({ accepted: true, stored_url: "/shell.php" })],
      }),
    });
    const finding = (await createFileUploadCheck(runner).run(ctx()))
      .find((item) => item.id === "upload-unrestricted-type")!;
    expect(finding.status).toBe("warn");
    expect(finding.severity).toBe("low");
    expect(finding.detail).toContain("client-side");
  });

  it("classificeert path-traversal uitsluitend uit de gemockte capture en noemt leftovers", async () => {
    const storedUrl = "https://example.com/uploads/canary.txt";
    const runner = makeRunner({
      ok: true,
      capture: capture({
        probes: [probe({
          probe_id: "upload-path-traversal",
          filename: "../canary.txt",
          content_type: "text/plain",
          active_type: false,
          accepted: true,
          stored_url: storedUrl,
        })],
        leftover_files: [storedUrl],
        cleaned_up: false,
      }),
    });
    const finding = (await createFileUploadCheck(runner).run(ctx()))
      .find((item) => item.id === "upload-path-traversal")!;
    expect(finding.severity).toBe("medium");
    expect(finding.detail).toContain(storedUrl);
    expect(runner.captureUploadFlow).toHaveBeenCalledTimes(1);
  });

  it("meldt een achtergebleven gesaniteerde traversal-canary zonder kwetsbaarheid te claimen", async () => {
    const storedUrl = "https://example.com/uploads/canary.txt";
    const runner = makeRunner({
      ok: true,
      capture: capture({
        probes: [probe({
          probe_id: "upload-path-traversal",
          filename: "../canary.txt",
          content_type: "text/plain",
          active_type: false,
          accepted: false,
          stored_url: storedUrl,
        })],
        leftover_files: [storedUrl],
        cleaned_up: false,
      }),
    });

    const finding = (await createFileUploadCheck(runner).run(ctx()))
      .find((item) => item.id === "upload-path-traversal")!;
    expect(finding.severity).toBe("info");
    expect(finding.detail).toContain(storedUrl);
  });

  it("begrensd evidence rond 4 KB", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({ probes: [probe({ accepted: true, stored_url: "/shell.php", retrieved_body: "x".repeat(20_000) })] }),
    });
    const finding = (await createFileUploadCheck(runner).run(ctx()))[0]!;
    expect(finding.evidence).not.toBeNull();
    expect((finding.evidence as { response: string }).response.length).toBeLessThanOrEqual(4_100);
    expect(finding.active).toBe(true);
  });
});
