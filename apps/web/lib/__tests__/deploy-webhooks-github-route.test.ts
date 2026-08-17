import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/github/route";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptWebhookSecret } from "@scanpal/notify";
import {
  listSitesByGithubRepo,
  startDeployScan,
  verifyHmacSignature,
} from "@/lib/deploy-webhooks";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
  env: { webhookSecretKey: "test-key" },
}));
vi.mock("@scanpal/notify", () => ({
  decryptWebhookSecret: vi.fn(),
}));
vi.mock("@/lib/deploy-webhooks", () => ({
  listSitesByGithubRepo: vi.fn(),
  startDeployScan: vi.fn(),
  verifyHmacSignature: vi.fn(),
}));

const queryMock = vi.mocked(pool.query);
const decryptMock = vi.mocked(decryptWebhookSecret);
const listSitesMock = vi.mocked(listSitesByGithubRepo);
const startDeployMock = vi.mocked(startDeployScan);
const verifyMock = vi.mocked(verifyHmacSignature);

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";

const PUSH_BODY = JSON.stringify({
  ref: "refs/heads/main",
  repository: { full_name: "Owner/Repo", default_branch: "main" },
});

const SITE = {
  id: SITE_ID,
  team_id: TEAM_ID,
  url: "example.com",
  github_webhook_secret: "encrypted",
};

function postResponse(
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  const request = new NextRequest("http://localhost/api/webhooks/github", {
    method: "POST",
    headers,
    body,
  });
  return POST(request);
}

describe("POST /api/webhooks/github", () => {
  beforeEach(() => {
    queryMock.mockReset();
    decryptMock.mockReset();
    decryptMock.mockReturnValue("geheim");
    listSitesMock.mockReset();
    startDeployMock.mockReset();
    verifyMock.mockReset();
    verifyMock.mockReturnValue(true);
    env.webhookSecretKey = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 400 zonder event-header of handtekening", async () => {
    expect((await postResponse({})).status).toBe(400);
    expect((await postResponse({ "x-github-event": "push" })).status).toBe(400);
  });

  it("acknowledged een onbekend event (ping) met 200", async () => {
    const response = await postResponse(
      { "x-github-event": "ping", "x-hub-signature-256": "sha256=x" },
      "{}",
    );
    expect(response.status).toBe(200);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("slaat een push op een andere branch over", async () => {
    const response = await postResponse(
      { "x-github-event": "push", "x-hub-signature-256": "sha256=x" },
      JSON.stringify({
        ref: "refs/heads/feature/x",
        repository: { full_name: "Owner/Repo", default_branch: "main" },
      }),
    );
    expect(response.status).toBe(200);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("slaat een deployment_status zonder success over", async () => {
    const response = await postResponse(
      { "x-github-event": "deployment_status", "x-hub-signature-256": "sha256=x" },
      JSON.stringify({
        deployment_status: { state: "pending" },
        repository: { full_name: "Owner/Repo" },
      }),
    );
    expect(response.status).toBe(200);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("geeft 400 bij een ongeldige payload", async () => {
    const response = await postResponse(
      { "x-github-event": "push", "x-hub-signature-256": "sha256=x" },
      JSON.stringify({ onzin: true }),
    );
    expect(response.status).toBe(400);
  });

  it("geeft 503 zonder WEBHOOK_SECRET_KEY", async () => {
    env.webhookSecretKey = "";
    const response = await postResponse(
      { "x-github-event": "push", "x-hub-signature-256": "sha256=x" },
      PUSH_BODY,
    );
    expect(response.status).toBe(503);
  });

  it("acknowledged een repo zonder gematched site (geen 404-leak)", async () => {
    listSitesMock.mockResolvedValue([] as never);
    const response = await postResponse(
      { "x-github-event": "push", "x-hub-signature-256": "sha256=x" },
      PUSH_BODY,
    );
    expect(response.status).toBe(200);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("geeft 401 bij een ongeldige handtekening", async () => {
    listSitesMock.mockResolvedValue([SITE] as never);
    verifyMock.mockReturnValue(false);
    const response = await postResponse(
      { "x-github-event": "push", "x-hub-signature-256": "sha256=onjuist" },
      PUSH_BODY,
    );
    expect(response.status).toBe(401);
    expect(startDeployMock).not.toHaveBeenCalled();
  });

  it("start een scan en antwoordt 202 met scan_id", async () => {
    listSitesMock.mockResolvedValue([SITE] as never);
    startDeployMock.mockResolvedValue({
      status: "started",
      scanId: "scan-1",
    } as never);

    const response = await postResponse(
      { "x-github-event": "push", "x-hub-signature-256": "sha256=abc" },
      PUSH_BODY,
    );
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.scans).toEqual([{ site_id: SITE_ID, scan_id: "scan-1" }]);
    expect(decryptMock).toHaveBeenCalledWith("test-key", "encrypted");
    expect(startDeployMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ siteId: SITE_ID, teamId: TEAM_ID }),
    );
  });

  it("antwoordt 200 { skipped: true } als alles is overgeslagen", async () => {
    listSitesMock.mockResolvedValue([SITE] as never);
    startDeployMock.mockResolvedValue({
      status: "skipped",
      reason: "cooldown",
    } as never);

    const response = await postResponse(
      { "x-github-event": "deployment_status", "x-hub-signature-256": "sha256=abc" },
      JSON.stringify({
        deployment_status: { state: "success", environment: "production" },
        repository: { full_name: "Owner/Repo" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skipped).toBe(true);
  });
});