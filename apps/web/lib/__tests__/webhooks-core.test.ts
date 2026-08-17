import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db";
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
  WebhookLimitError,
  WebhookNotConfiguredError,
  WebhookUrlError,
} from "@/lib/webhooks-core";
import { encryptWebhookSecret } from "@scanpal/notify";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const queryMock = vi.mocked(pool.query);

const KEY = "c2hhMjU2LW5vdC1hLXNlY3JldC1mb3ItZWFjaC1zdGVw";
const SECRET_KEY_B64 = Buffer.from("x".repeat(32)).toString("base64");

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    team_id: "00000000-0000-4000-8000-0000000000b1",
    created_by: "user-1",
    name: "CI-pipeline",
    url: "https://hooks.example.com/scanpal",
    secret_encrypted: encryptWebhookSecret(SECRET_KEY_B64, KEY),
    events: ["scan_done", "score_drop"],
    active: true,
    failure_count: 0,
    last_delivery_at: null,
    last_http_status: null,
    created_at: new Date("2026-08-16T08:00:00.000Z"),
    updated_at: new Date("2026-08-16T08:00:00.000Z"),
    ...overrides,
  };
}

function makeDeliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    webhook_id: "00000000-0000-4000-8000-0000000000a1",
    event: "scan_done",
    payload: { site_name: "voorbeeld.nl" },
    status: "ok",
    http_status: 200,
    error: null,
    attempts: 1,
    next_attempt_at: null,
    dedup_key: "scan_done:wh:scan-1:",
    created_at: new Date("2026-08-16T08:00:00.000Z"),
    delivered_at: new Date("2026-08-16T08:00:05.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("createWebhook", () => {
  it("versleutelt het secret en retourneert view + full secret 1×", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ n: 0 }] } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [makeRow()] } as never);

    const result = await createWebhook(pool, {
      teamId: "team-1",
      createdBy: "user-1",
      name: "CI-pipeline",
      url: "https://hooks.example.com/scanpal",
      events: ["scan_done"],
      secretKey: SECRET_KEY_B64,
      maxWebhooks: 3,
    });

    const [countSql] = queryMock.mock.calls[0];
    const [insertSql, insertParams] = queryMock.mock.calls[1];
    expect(String(countSql)).toContain("count(*)");
    expect(String(insertSql)).toContain("insert into webhooks");
    const secretParam = insertParams![4] as string;
    expect(secretParam).toMatch(/^v1\./);
    expect(secretParam).not.toContain(result.secret);
    expect(result.view.name).toBe("CI-pipeline");
    expect(result.view).not.toHaveProperty("secret_encrypted");
    expect(result.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("gooit WebhookLimitError boven de plan-limiet", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ n: 3 }] } as never);

    await expect(
      createWebhook(pool, {
        teamId: "team-1",
        createdBy: "user-1",
        name: "X",
        url: "https://hooks.example.com/x",
        events: ["scan_done"],
        secretKey: SECRET_KEY_B64,
        maxWebhooks: 3,
      }),
    ).rejects.toThrow(WebhookLimitError);
  });

  it("gooit WebhookNotConfiguredError zonder secretKey", async () => {
    await expect(
      createWebhook(pool, {
        teamId: "team-1",
        createdBy: "user-1",
        name: "X",
        url: "https://hooks.example.com/x",
        events: ["scan_done"],
        secretKey: "",
        maxWebhooks: 3,
      }),
    ).rejects.toThrow(WebhookNotConfiguredError);
  });

  it("gooit WebhookUrlError bij een loopback-URL", async () => {
    await expect(
      createWebhook(pool, {
        teamId: "team-1",
        createdBy: "user-1",
        name: "X",
        url: "http://127.0.0.1:3000/hook",
        events: ["scan_done"],
        secretKey: SECRET_KEY_B64,
        maxWebhooks: 3,
      }),
    ).rejects.toThrow(WebhookUrlError);
  });
});

describe("listWebhooks / updateWebhook / deleteWebhook / rotateWebhookSecret", () => {
  it("lijst is team-scoped en bevat geen secret", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow()] } as never);

    const webhooks = await listWebhooks(pool, "team-1");

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("where team_id = $1");
    expect(params![0]).toBe("team-1");
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].url).toBe("https://hooks.example.com/scanpal");
    expect(webhooks[0]).not.toHaveProperty("secret_encrypted");
  });

  it("update weigert een private URL (WebhookUrlError)", async () => {
    await expect(
      updateWebhook(pool, {
        teamId: "team-1",
        webhookId: "wh-1",
        patch: { url: "https://10.0.0.1/hook" },
        secretKey: SECRET_KEY_B64,
      }),
    ).rejects.toThrow(WebhookUrlError);
  });

  it("update zet alleen meegegeven velden + updated_at", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow({ active: false })] } as never);

    const view = await updateWebhook(pool, {
      teamId: "team-1",
      webhookId: "wh-1",
      patch: { active: false },
      secretKey: SECRET_KEY_B64,
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("set active = $3, updated_at = now()");
    expect(params).toEqual(["wh-1", "team-1", false]);
    expect(view?.active).toBe(false);
  });

  it("delete retourneert false bij een webhook van een ander team", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    const deleted = await deleteWebhook(pool, { teamId: "team-2", webhookId: "wh-1" });
    expect(deleted).toBe(false);
  });

  it("rotate genereert een nieuw versleuteld secret en retourneert het 1×", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [makeRow()] } as never);

    const result = await rotateWebhookSecret(pool, {
      teamId: "team-1",
      webhookId: "wh-1",
      secretKey: SECRET_KEY_B64,
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("set secret_encrypted = $3");
    expect(params![2]).toMatch(/^v1\./);
    expect(result?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("listWebhookDeliveries", () => {
  it("levert deliveries + total voor een team-webhook", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [makeDeliveryRow()] } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ n: 1 }] } as never);

    const result = await listWebhookDeliveries(pool, {
      teamId: "team-1",
      webhookId: "wh-1",
      limit: 20,
      offset: 0,
    });

    const [listSql, listParams] = queryMock.mock.calls[0];
    expect(String(listSql)).toContain("join webhooks w on w.id = d.webhook_id");
    expect(String(listSql)).toContain("w.team_id = $1");
    expect(listParams).toEqual(["team-1", "wh-1", 20, 0]);
    expect(result.total).toBe(1);
    expect(result.deliveries[0]).toMatchObject({
      status: "ok",
      http_status: 200,
      attempts: 1,
      event: "scan_done",
    });
  });
});
