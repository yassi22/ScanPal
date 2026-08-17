import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listGET, POST as createPOST } from "@/app/api/webhooks/route";
import { DELETE, PATCH } from "@/app/api/webhooks/[id]/route";
import { POST as rotatePOST } from "@/app/api/webhooks/[id]/secret/route";
import { POST as testPOST } from "@/app/api/webhooks/[id]/test/route";
import { GET as deliveriesGET } from "@/app/api/webhooks/[id]/deliveries/route";
import { requireSessionTeam, requireSessionOwner } from "@/lib/api-auth";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhookDeliveries,
  listWebhooks,
  rotateWebhookSecret,
  sendTestWebhook,
  updateWebhook,
  WebhookLimitError,
  WebhookNotConfiguredError,
  WebhookUrlError,
} from "@/lib/webhooks-core";
import { getPlanForTeam } from "@/lib/credits";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
  env: { webhookSecretKey: "c2VjcmV0LWtleS0zMi1ieXRlcw==" },
}));
vi.mock("@/lib/api-auth", () => ({
  requireSessionTeam: vi.fn(),
  requireSessionOwner: vi.fn(),
}));
vi.mock("@/lib/webhooks-core", () => ({
  createWebhook: vi.fn(),
  listWebhooks: vi.fn(),
  getWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  sendTestWebhook: vi.fn(),
  WebhookLimitError: class extends Error {},
  WebhookNotConfiguredError: class extends Error {},
  WebhookUrlError: class extends Error {},
}));
vi.mock("@/lib/credits", () => ({
  getPlanForTeam: vi.fn(),
}));

const requireSessionMock = vi.mocked(requireSessionTeam);
const requireOwnerMock = vi.mocked(requireSessionOwner);
const listMock = vi.mocked(listWebhooks);
const createMock = vi.mocked(createWebhook);
const updateMock = vi.mocked(updateWebhook);
const deleteMock = vi.mocked(deleteWebhook);
const rotateMock = vi.mocked(rotateWebhookSecret);
const deliveriesMock = vi.mocked(listWebhookDeliveries);
const sendTestMock = vi.mocked(sendTestWebhook);
const getWebhookMock = vi.mocked(getWebhook);
const planMock = vi.mocked(getPlanForTeam);

const WH_ID = "00000000-0000-4000-8000-0000000000a1";

function teamCtx() {
  requireSessionMock.mockResolvedValue({
    ok: true,
    ctx: { teamId: "team-1", userId: "user-1" },
  } as never);
}

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    id: WH_ID,
    team_id: "00000000-0000-4000-8000-0000000000b1",
    name: "CI-pipeline",
    url: "https://hooks.example.com/scanpal",
    events: ["scan_done"],
    active: true,
    failure_count: 0,
    last_delivery_at: null,
    last_http_status: null,
    created_at: "2026-08-16T08:00:00.000Z",
    updated_at: "2026-08-16T08:00:00.000Z",
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    webhook_id: WH_ID,
    event: "scan_done",
    status: "ok",
    http_status: 200,
    error: null,
    attempts: 1,
    next_attempt_at: null,
    created_at: "2026-08-16T08:00:00.000Z",
    delivered_at: "2026-08-16T08:00:05.000Z",
    ...overrides,
  };
}
function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function idParams() {
  return { params: Promise.resolve({ id: WH_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  teamCtx();
  planMock.mockResolvedValue({ maxWebhooks: 3 } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/webhooks", () => {
  it("401 zonder sessie (géén bearer keys)", async () => {
    requireSessionMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await listGET();
    expect(response.status).toBe(401);
  });

  it("retourneert de team-webhooks zonder secret", async () => {
    listMock.mockResolvedValue([makeView()] as never);
    const response = await listGET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.webhooks).toHaveLength(1);
    expect(body.webhooks[0]).not.toHaveProperty("secret");
  });
});

describe("POST /api/webhooks", () => {
  it("maakt een webhook aan en retourneert het secret 1× (201)", async () => {
    planMock.mockResolvedValue({ maxWebhooks: 3 } as never);
    createMock.mockResolvedValue({
      view: makeView(),
      secret: "abc123",
    } as never);

    const response = await createPOST(
      jsonRequest("http://localhost/api/webhooks", {
        name: "CI-pipeline",
        url: "https://hooks.example.com/scanpal",
        events: ["scan_done", "score_drop"],
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.secret).toBe("abc123");
    expect(body.webhook.name).toBe("CI-pipeline");
  });

  it("400 bij een ongeldige body", async () => {
    const response = await createPOST(
      jsonRequest("http://localhost/api/webhooks", { name: "", url: "x", events: [] }),
    );
    expect(response.status).toBe(400);
  });

  it("403 bij de webhook-limiet", async () => {
    createMock.mockRejectedValue(new WebhookLimitError(3));
    const response = await createPOST(
      jsonRequest("http://localhost/api/webhooks", {
        name: "X",
        url: "https://hooks.example.com/x",
        events: ["scan_done"],
      }),
    );
    expect(response.status).toBe(403);
  });

  it("400 bij een niet-toegestane URL (SSRF)", async () => {
    createMock.mockRejectedValueOnce(new WebhookUrlError("blocked-ip"));
    const response = await createPOST(
      jsonRequest("http://localhost/api/webhooks", {
        name: "X",
        url: "http://127.0.0.1/hook",
        events: ["scan_done"],
      }),
    );
    expect(response.status).toBe(400);
  });

  it("503 als webhooks niet zijn geconfigureerd", async () => {
    createMock.mockRejectedValueOnce(new WebhookNotConfiguredError());
    const response = await createPOST(
      jsonRequest("http://localhost/api/webhooks", {
        name: "X",
        url: "https://hooks.example.com/x",
        events: ["scan_done"],
      }),
    );
    expect(response.status).toBe(503);
  });
});

describe("PATCH /api/webhooks/[id]", () => {
  it("werkt een veld bij (team-scoped)", async () => {
    updateMock.mockResolvedValue(makeView({ active: false }) as never);

    const response = await PATCH(
      jsonRequest(`http://localhost/api/webhooks/${WH_ID}`, { active: false }),
      idParams(),
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      webhookId: WH_ID,
      patch: { active: false },
      secretKey: expect.any(String),
    });
    const body = await response.json();
    expect(body.active).toBe(false);
  });

  it("404 bij een webhook van een ander team", async () => {
    updateMock.mockResolvedValue(null);
    const response = await PATCH(
      jsonRequest(`http://localhost/api/webhooks/${WH_ID}`, { name: "X" }),
      idParams(),
    );
    expect(response.status).toBe(404);
  });

  it("400 bij een lege patch", async () => {
    const response = await PATCH(
      jsonRequest(`http://localhost/api/webhooks/${WH_ID}`, {}),
      idParams(),
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/webhooks/[id]", () => {
  it("verwijdert (204)", async () => {
    deleteMock.mockResolvedValue(true);
    const response = await DELETE(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}`, { method: "DELETE" }),
      idParams(),
    );
    expect(response.status).toBe(204);
  });

  it("404 voor een ander team", async () => {
    deleteMock.mockResolvedValue(false);
    const response = await DELETE(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}`, { method: "DELETE" }),
      idParams(),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/webhooks/[id]/secret", () => {
  it("owner-only: 403 voor een member", async () => {
    requireOwnerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await rotatePOST(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}/secret`, { method: "POST" }),
      idParams(),
    );
    expect(response.status).toBe(403);
  });

  it("roteert het secret en retourneert het 1×", async () => {
    requireOwnerMock.mockResolvedValue({
      ok: true,
      ctx: { teamId: "team-1", userId: "user-1" },
    } as never);
    rotateMock.mockResolvedValue({
      view: makeView(),
      secret: "nieuw-secret",
    } as never);

    const response = await rotatePOST(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}/secret`, { method: "POST" }),
      idParams(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.secret).toBe("nieuw-secret");
  });
});

describe("POST /api/webhooks/[id]/test", () => {
  it("stuurt een test-delivery en retourneert het resultaat", async () => {
    sendTestMock.mockResolvedValue({ delivery: makeDelivery({ event: "test" }) } as never);

    const response = await testPOST(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}/test`, { method: "POST" }),
      idParams(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.delivery.event).toBe("test");
    expect(sendTestMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      webhookId: WH_ID,
      secretKey: expect.any(String),
    });
  });

  it("404 bij een webhook van een ander team", async () => {
    sendTestMock.mockResolvedValue(null);
    const response = await testPOST(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}/test`, { method: "POST" }),
      idParams(),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /api/webhooks/[id]/deliveries", () => {
  it("levert het delivery-log (paginated)", async () => {
    getWebhookMock.mockResolvedValue({ id: WH_ID, team_id: "team-1" } as never);
    deliveriesMock.mockResolvedValue({
      deliveries: [makeDelivery()],
      total: 1,
    } as never);

    const response = await deliveriesGET(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}/deliveries?limit=5`),
      idParams(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.deliveries[0].status).toBe("ok");
    expect(deliveriesMock).toHaveBeenCalledWith(expect.anything(), {
      teamId: "team-1",
      webhookId: WH_ID,
      limit: 5,
      offset: 0,
    });
  });

  it("404 voor een webhook van een ander team", async () => {
    getWebhookMock.mockResolvedValue(null);
    const response = await deliveriesGET(
      new NextRequest(`http://localhost/api/webhooks/${WH_ID}/deliveries`),
      idParams(),
    );
    expect(response.status).toBe(404);
  });
});
