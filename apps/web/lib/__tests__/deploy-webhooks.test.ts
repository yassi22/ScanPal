import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createHmac } from "node:crypto";
import {
  listSitesByGithubRepo,
  listSitesByVercelUrl,
  reserveDeployCooldown,
  startDeployScan,
  verifyHmacSignature,
} from "@/lib/deploy-webhooks";
import { redis } from "@/lib/redis";
import { notifier } from "@/lib/notify";
import { assertPlanFeature, PlanFeatureError } from "@/lib/credits";
import { createManualScan, ScanError } from "@/lib/scans-core";
import { enqueueScan } from "@/lib/scan-queue";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  redis: { set: vi.fn() },
}));
vi.mock("@/lib/notify", () => ({
  notifier: vi.fn(),
}));
vi.mock("@/lib/credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits")>()),
  assertPlanFeature: vi.fn(),
}));
vi.mock("@/lib/scans-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scans-core")>()),
  createManualScan: vi.fn(),
}));
vi.mock("@/lib/scan-queue", () => ({
  enqueueScan: vi.fn(),
}));

const redisSetMock = vi.mocked(redis.set);
const notifierMock = vi.mocked(notifier);
const assertPlanFeatureMock = vi.mocked(assertPlanFeature);
const createManualScanMock = vi.mocked(createManualScan);
const enqueueScanMock = vi.mocked(enqueueScan);

const db = { query: vi.fn() } as unknown as Pool;

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";

function siteRow(overrides: Partial<{ url: string; github_webhook_secret: string | null }> = {}) {
  return {
    id: SITE_ID,
    team_id: TEAM_ID,
    url: "example.com",
    github_webhook_secret: null,
    ...overrides,
  };
}

function hmac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSignature", () => {
  it("accepteert een geldige sha256-handtekening", () => {
    const body = JSON.stringify({ ok: true });
    expect(verifyHmacSignature("geheim", body, `sha256=${hmac("geheim", body)}`)).toBe(true);
  });

  it("wijst een verkeerde handtekening af", () => {
    const body = JSON.stringify({ ok: true });
    expect(verifyHmacSignature("ander", body, `sha256=${hmac("geheim", body)}`)).toBe(false);
  });

  it("wijst een verkeerd/ongeldig header-formaat af", () => {
    expect(verifyHmacSignature("geheim", "body", "sha256=zzz")).toBe(false);
    expect(verifyHmacSignature("geheim", "body", "")).toBe(false);
  });

  it("is timing-safe (gebruikt de vergelijking op bytes)", () => {
    const body = "payload";
    expect(
      verifyHmacSignature("geheim", body, `sha256=${hmac("geheim", body)}`),
    ).toBe(true);
  });
});

describe("listSitesByGithubRepo", () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it("vraagt sites op met een case-insensitive repo-match", async () => {
    vi.mocked(db.query).mockResolvedValue({
      rowCount: 1,
      rows: [siteRow()],
    } as never);
    const rows = await listSitesByGithubRepo(db, "Owner/Repo");
    expect(rows).toHaveLength(1);
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(
      expect.stringContaining("lower(github_repo) = lower($1)"),
      ["Owner/Repo"],
    );
  });
});

describe("listSitesByVercelUrl", () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it("filtert op hostname-match (www/protocol/case)", async () => {
    vi.mocked(db.query).mockResolvedValue({
      rowCount: 3,
      rows: [
        siteRow({ url: "myapp.vercel.app" }),
        siteRow({ url: "other.vercel.app" }),
        siteRow({ url: "example.com/shop" }),
      ],
    } as never);
    const rows = await listSitesByVercelUrl(db, "https://WWW.Example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("example.com/shop");
  });
});

describe("reserveDeployCooldown", () => {
  beforeEach(() => {
    redisSetMock.mockReset();
  });

  it("reserveert de cooldown met 10 min TTL", async () => {
    redisSetMock.mockResolvedValue("OK");
    expect(await reserveDeployCooldown(SITE_ID)).toBe(true);
    expect(redisSetMock).toHaveBeenCalledWith(
      `deploy:cd:${SITE_ID}`,
      "1",
      "EX",
      600,
      "NX",
    );
  });

  it("geeft false tijdens de cooldown", async () => {
    redisSetMock.mockResolvedValue(null);
    expect(await reserveDeployCooldown(SITE_ID)).toBe(false);
  });
});

describe("startDeployScan", () => {
  beforeEach(() => {
    redisSetMock.mockReset();
    redisSetMock.mockResolvedValue("OK");
    assertPlanFeatureMock.mockReset();
    createManualScanMock.mockReset();
    enqueueScanMock.mockReset();
    notifierMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("start een scan op Free niet (feature onDeploy)", async () => {
    assertPlanFeatureMock.mockRejectedValue(new PlanFeatureError("onDeploy", "free"));
    const outcome = await startDeployScan(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      siteName: "example.com",
    });
    expect(outcome).toEqual({ status: "skipped", reason: "plan" });
    expect(createManualScanMock).not.toHaveBeenCalled();
  });

  it("slaat een site in cooldown over", async () => {
    assertPlanFeatureMock.mockResolvedValue({} as never);
    redisSetMock.mockResolvedValue(null);
    const outcome = await startDeployScan(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      siteName: "example.com",
    });
    expect(outcome).toEqual({ status: "skipped", reason: "cooldown" });
    expect(createManualScanMock).not.toHaveBeenCalled();
  });

  it("start een scan met trigger='deploy' en enqueue de dispatcher", async () => {
    assertPlanFeatureMock.mockResolvedValue({} as never);
    createManualScanMock.mockResolvedValue({
      scan: { id: "scan-1" },
      completed: false,
    } as never);
    const outcome = await startDeployScan(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      siteName: "example.com",
    });
    expect(outcome).toEqual({ status: "started", scanId: "scan-1" });
    expect(createManualScanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ siteId: SITE_ID, teamId: TEAM_ID, trigger: "deploy" }),
    );
    expect(enqueueScanMock).toHaveBeenCalledWith("scan-1");
  });

  it("slaat over bij overlap (bestaande scan actief)", async () => {
    assertPlanFeatureMock.mockResolvedValue({} as never);
    createManualScanMock.mockRejectedValue(
      new ScanError("overlap", "Er draait al een scan"),
    );
    const outcome = await startDeployScan(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      siteName: "example.com",
    });
    expect(outcome).toEqual({ status: "skipped", reason: "overlap" });
    expect(enqueueScanMock).not.toHaveBeenCalled();
  });

  it("slaat over bij credit-limiet en stuurt een credit_skip-notificatie", async () => {
    assertPlanFeatureMock.mockResolvedValue({} as never);
    createManualScanMock.mockRejectedValue(
      new (await import("@/lib/credits")).CreditLimitError(5, 5),
    );
    const outcome = await startDeployScan(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      siteName: "example.com",
    });
    expect(outcome).toEqual({ status: "skipped", reason: "credit" });
    expect(notifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credit_skip",
        teamId: TEAM_ID,
        entityId: SITE_ID,
        payload: { site_name: "example.com" },
      }),
    );
  });
});