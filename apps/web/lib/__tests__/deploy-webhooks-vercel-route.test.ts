import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/vercel/route";
import { env } from "@/lib/env";
import {
  listSitesByVercelUrl,
  startDeployScan,
  verifyHmacSignature,
} from "@/lib/deploy-webhooks";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
  env: { vercelWebhookSecret: "vercel-secret" },
}));
vi.mock("@/lib/deploy-webhooks", () => ({
  listSitesByVercelUrl: vi.fn(),
  startDeployScan: vi.fn(),
  verifyHmacSignature: vi.fn(),
}));

const listSitesMock = vi.mocked(listSitesByVercelUrl);
const startDeployMock = vi.mocked(startDeployScan);
const verifyMock = vi.mocked(verifyHmacSignature);

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";

const BODY = JSON.stringify({
  type: "deployment.completed",
  payload: { project: { name: "myapp" }, url: "myapp.vercel.app" },
});

const SITE = {
  id: SITE_ID,
  team_id: TEAM_ID,
  url: "myapp.vercel.app",
  github_webhook_secret: null,
};

function postResponse(headers: Record<string, string>, body?: string): Promise<Response> {
  const request = new NextRequest("http://localhost/api/webhooks/vercel", {
    method: "POST",
    headers,
    body,
  });
  return POST(request);
}

describe("POST /api/webhooks/vercel", () => {
  beforeEach(() => {
    listSitesMock.mockReset();
    startDeployMock.mockReset();
    verifyMock.mockReset();
    verifyMock.mockReturnValue(true);
    env.vercelWebhookSecret = "vercel-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 400 zonder handtekening", async () => {
    expect((await postResponse({})).status).toBe(400);
  });

  it("geeft 503 zonder VERCEL_WEBHOOK_SECRET", async () => {
    env.vercelWebhookSecret = "";
    const response = await postResponse({ "x-vercel-signature": "x" }, BODY);
    expect(response.status).toBe(503);
  });

  it("geeft 401 bij een ongeldige handtekening", async () => {
    verifyMock.mockReturnValue(false);
    const response = await postResponse({ "x-vercel-signature": "x" }, BODY);
    expect(response.status).toBe(401);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it("geeft 400 bij een ongeldige payload", async () => {
    const response = await postResponse(
      { "x-vercel-signature": "x" },
      JSON.stringify({ type: "deployment.created", payload: { url: "x" } }),
    );
    expect(response.status).toBe(400);
  });

  it("acknowledged zonder gematched site (geen 404-leak)", async () => {
    listSitesMock.mockResolvedValue([] as never);
    const response = await postResponse({ "x-vercel-signature": "x" }, BODY);
    expect(response.status).toBe(200);
  });

  it("start een scan en antwoordt 202 met scan_id", async () => {
    listSitesMock.mockResolvedValue([SITE] as never);
    startDeployMock.mockResolvedValue({ status: "started", scanId: "scan-1" } as never);

    const response = await postResponse({ "x-vercel-signature": "x" }, BODY);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.scans).toEqual([{ site_id: SITE_ID, scan_id: "scan-1" }]);
    expect(startDeployMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ siteId: SITE_ID, teamId: TEAM_ID }),
    );
  });

  it("antwoordt 200 { skipped: true } als alles is overgeslagen", async () => {
    listSitesMock.mockResolvedValue([SITE] as never);
    startDeployMock.mockResolvedValue({ status: "skipped", reason: "plan" } as never);

    const response = await postResponse({ "x-vercel-signature": "x" }, BODY);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skipped).toBe(true);
  });
});