import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sites/[id]/deploy-webhook/route";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptWebhookSecret, generateWebhookSecret } from "@scanpal/notify";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
  env: { webhookSecretKey: "test-key", appUrl: "https://scanpal.dev" },
}));
vi.mock("@scanpal/notify", () => ({
  encryptWebhookSecret: vi.fn(),
  generateWebhookSecret: vi.fn(),
}));
vi.mock("@/lib/deploy-webhooks", () => ({
  DeployWebhookNotConfiguredError: class DeployWebhookNotConfiguredError extends Error {},
}));

const queryMock = vi.mocked(pool.query);
const requireOwnerMock = vi.mocked(requireSessionOwner);
const encryptMock = vi.mocked(encryptWebhookSecret);
const generateMock = vi.mocked(generateWebhookSecret);

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";

function postResponse(id = SITE_ID): Promise<Response> {
  const request = new NextRequest(
    `http://localhost/api/sites/${id}/deploy-webhook`,
    { method: "POST" },
  );
  return POST(request, { params: Promise.resolve({ id }) });
}

describe("POST /api/sites/[id]/deploy-webhook", () => {
  beforeEach(() => {
    queryMock.mockReset();
    requireOwnerMock.mockReset();
    encryptMock.mockReset();
    encryptMock.mockReturnValue("v1.encrypted");
    generateMock.mockReset();
    generateMock.mockReturnValue("generated-secret");
    env.webhookSecretKey = "test-key";
    env.appUrl = "https://scanpal.dev";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 403 voor een niet-owner", async () => {
    requireOwnerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await postResponse();
    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("geeft 503 zonder WEBHOOK_SECRET_KEY", async () => {
    requireOwnerMock.mockResolvedValue({
      ok: true,
      ctx: { teamId: TEAM_ID, auth: { type: "session", userId: "user-1" } },
    } as never);
    env.webhookSecretKey = "";
    const response = await postResponse();
    expect(response.status).toBe(503);
  });

  it("geeft 404 voor een site die het team niet bezit", async () => {
    requireOwnerMock.mockResolvedValue({
      ok: true,
      ctx: { teamId: TEAM_ID, auth: { type: "session", userId: "user-1" } },
    } as never);
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await postResponse();
    expect(response.status).toBe(404);
  });

  it("genereert een secret, versleutelt het en retourneert URL + secret 1×", async () => {
    requireOwnerMock.mockResolvedValue({
      ok: true,
      ctx: { teamId: TEAM_ID, auth: { type: "session", userId: "user-1" } },
    } as never);
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: SITE_ID }] } as never);

    const response = await postResponse();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.url).toBe("https://scanpal.dev/api/webhooks/github");
    expect(body.secret).toBe("generated-secret");
    expect(encryptMock).toHaveBeenCalledWith("test-key", "generated-secret");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("github_webhook_secret"),
      ["v1.encrypted", SITE_ID, TEAM_ID],
    );
  });
});