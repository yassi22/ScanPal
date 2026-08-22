import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { webhookEnvelopeSchema } from "@scanpal/shared";
import {
  createWebhookDeliverer,
  entityIdFromDedupKey,
  enrichPayload,
  signPayload,
  verifySignature,
} from "../webhook-deliverer";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateSecretKey,
  generateWebhookSecret,
} from "../webhook-secret";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

type Delivery = {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  http_status: number | null;
  error: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  dedup_key: string;
  created_at: Date;
  delivered_at: Date | null;
};

type Webhook = {
  id: string;
  team_id: string;
  name: string;
  url: string;
  secret_encrypted: string;
  active: boolean;
  failure_count: number;
  last_delivery_at: Date | null;
  last_http_status: number | null;
};

const KEY = generateSecretKey();
const CREATED_AT = new Date("2026-08-16T08:00:00.000Z");
const NOW = new Date("2026-08-16T10:00:00.000Z");

function fakePool(
  delivery: Delivery,
  webhook: Webhook,
  opts: { dueRows: boolean } = { dueRows: true },
) {
  const state = { delivery, webhook, webhookUpdates: 0, deliveryUpdates: 0 };

  /** Gejoined rij zoals pg die retourneert: d.id wint, w.id wordt niet geselecteerd. */
  function joinedRow() {
    return {
      ...state.delivery,
      ...state.webhook,
      id: state.delivery.id,
      webhook_id: state.delivery.webhook_id,
    };
  }

  /** UPDATE-clause in de fake toepassen: `col = $n | 'lit' | null | now() | expr`. */
  function applySet(target: "delivery" | "webhook", sql: string, params: unknown[]) {
    const setClause = sql.match(/set (.+?)(?: where|$)/i)?.[1] ?? "";
    const patch: Record<string, unknown> = {};
    for (const assignment of setClause.split(",")) {
      const [col, expr] = assignment.trim().split(/\s*=\s*/);
      if (!col) continue;
      const ref = expr?.match(/^\$(\d+)$/);
      if (ref) {
        patch[col] = params[Number(ref[1]) - 1];
        continue;
      }
      if (expr === "null") {
        patch[col] = null;
        continue;
      }
      if (expr === "now()") {
        patch[col] = NOW;
        continue;
      }
      if (expr === "failure_count + 1") {
        patch[col] = (state[target] as Webhook).failure_count + 1;
        continue;
      }
      if (expr?.startsWith("'") && expr.endsWith("'")) {
        const literal = expr.slice(1, -1);
        if (literal === "true") {
          patch[col] = true;
        } else if (literal === "false") {
          patch[col] = false;
        } else if (literal !== "" && Number.isFinite(Number(literal))) {
          patch[col] = Number(literal);
        } else {
          patch[col] = literal;
        }
        continue;
      }
      if (expr === "true") {
        patch[col] = true;
        continue;
      }
      if (expr === "false") {
        patch[col] = false;
        continue;
      }
      if (expr !== undefined && expr !== "" && Number.isFinite(Number(expr))) {
        patch[col] = Number(expr);
        continue;
      }
      patch[col] = expr;
    }
    state[target] = { ...state[target], ...patch } as never;
  }

  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();

      if (text === "begin" || text === "commit" || text === "rollback") {
        return { rowCount: 0, rows: [] };
      }

      if (text.startsWith("select d.id, d.webhook_id")) {
        if (text.includes("where d.id")) {
          return { rowCount: 1, rows: [joinedRow()] };
        }
        return {
          rowCount: opts.dueRows ? 1 : 0,
          rows: opts.dueRows ? [joinedRow()] : [],
        };
      }

      if (text.startsWith("select sc.id as scan_id")) {
        const enrichment = params[0] === "scan-1";
        if (enrichment) {
          return {
            rowCount: 1,
            rows: [
              {
                scan_id: "scan-1",
                score: 82,
                site_id: "site-1",
                site_url: "https://voorbeeld.nl",
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      }

      if (text.startsWith("update webhook_deliveries")) {
        state.deliveryUpdates += 1;
        applySet("delivery", text, params);
        return { rowCount: 1, rows: [] };
      }

      if (text.startsWith("update webhooks")) {
        state.webhookUpdates += 1;
        applySet("webhook", text, params);
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`onbekende query in test-fake: ${text}`);
    },
    connect: async () => ({
      query: (sql: string, params: unknown[] = []) => db.query(sql, params),
      release: () => {},
    }),
  };

  return { db: db as unknown as Pool, state };
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    webhook_id: "00000000-0000-4000-8000-0000000000a1",
    event: "scan_done",
    payload: { site_name: "voorbeeld.nl", score: 82 },
    status: "pending",
    http_status: null,
    error: null,
    attempts: 0,
    next_attempt_at: null,
    dedup_key: "scan_done:wh-1:scan-1:",
    created_at: CREATED_AT,
    delivered_at: null,
    ...overrides,
  };
}

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    team_id: "00000000-0000-4000-8000-0000000000b1",
    name: "CI-pipeline",
    url: "https://hooks.example.com/scanpal",
    secret_encrypted: encryptWebhookSecret(KEY, "test-secret"),
    active: true,
    failure_count: 0,
    last_delivery_at: null,
    last_http_status: null,
    ...overrides,
  };
}

function fetchWith(
  status: number,
  opts: { location?: string } = {},
): typeof fetch {
  return vi.fn(async () => {
    const headers = new Headers();
    if (opts.location) headers.set("location", opts.location);
    return { status, headers } as unknown as Response;
  }) as unknown as typeof fetch;
}

function delivererFor(
  db: Pool,
  overrides: { maxAttempts?: number; notify?: (input: unknown) => Promise<unknown> | unknown } = {},
) {
  return createWebhookDeliverer({
    db,
    secretKey: KEY,
    log: () => {},
    now: () => NOW,
    fetchFn: fetchWith(200),
    notify: overrides.notify,
    maxAttempts: overrides.maxAttempts,
  });
}

function makeState(overrides: { delivery?: Partial<Delivery>; webhook?: Partial<Webhook> } = {}) {
  return fakePool(makeDelivery(overrides.delivery), makeWebhook(overrides.webhook));
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("signPayload / verifySignature", () => {
  it("tekent de raw body met HMAC-SHA256 en verifieert timing-safe", () => {
    const signature = signPayload("geheim", '{"a":1}');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature("geheim", '{"a":1}', signature)).toBe(true);
    expect(verifySignature("ander-geheim", '{"a":1}', signature)).toBe(false);
    expect(verifySignature("geheim", '{"a":2}', signature)).toBe(false);
    expect(verifySignature("geheim", '{"a":1}', "sha256=000")).toBe(false);
  });

  it("entityIdFromDedupKey haalt part 2 uit de key (ook met kolon in incident)", () => {
    expect(entityIdFromDedupKey("scan_done:wh-1:scan-1:")).toBe("scan-1");
    expect(
      entityIdFromDedupKey("site_down:wh-1:site-1:2026-08-16T10:00:00.000Z"),
    ).toBe("site-1");
  });
});

describe("deliverOne — succes", () => {
  it("verstuurt een gesigneerde envelop en zet delivery + webhook op ok", async () => {
    const { db, state } = makeState();
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db,
      secretKey: KEY,
      log: () => {},
      now: () => NOW,
      fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "ok" });
    expect(state.delivery.status).toBe("ok");
    expect(state.delivery.attempts).toBe(1);
    expect(state.delivery.http_status).toBe(200);
    expect(state.webhook.failure_count).toBe(0);

    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://hooks.example.com/scanpal");
    expect(init.method).toBe("POST");
    expect(init.headers["x-scanpal-event"]).toBe("scan_done");
    expect(init.headers["x-scanpal-delivery"]).toBe(state.delivery.id);
    expect(init.headers["x-scanpal-timestamp"]).toMatch(/^\d{10}$/);
    expect(init.headers["x-scanpal-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    const envelope = webhookEnvelopeSchema.parse(JSON.parse(init.body));
    expect(envelope.version).toBe(1);
    expect(envelope.id).toBe(state.delivery.id);
    expect(envelope.team_id).toBe(state.webhook.team_id);
    expect(envelope.data.site_name).toBe("voorbeeld.nl");
    expect(envelope.data.scan_id).toBe("scan-1");
    expect(envelope.data.site_url).toBe("https://voorbeeld.nl");
    expect(envelope.data.score).toBe(82);

    expect(
      verifySignature("test-secret", init.body, init.headers["x-scanpal-signature"]),
    ).toBe(true);
  });

  it("verrijkt met site-context bij een site-entity", async () => {
    const { db } = makeState({
      delivery: { dedup_key: "site_down:wh-1:site-1:inc-1", event: "site_down" },
    });
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    await deliverer.deliverOne("del-1");

    const body = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const envelope = webhookEnvelopeSchema.parse(JSON.parse(body));
    expect(envelope.data.site_url).toBeUndefined(); // site-1 staat niet in de fake-enrichment
    expect(envelope.event).toBe("site_down");
  });

  it("enrichPayload vult alleen ontbrekende velden aan", async () => {
    const { db } = makeState();
    const enriched = await enrichPayload(db, "scan-1", {
      site_name: "voorbeeld.nl",
      site_id: "al-bekend",
    });
    expect(enriched.site_id).toBe("al-bekend");
    expect(enriched.scan_id).toBe("scan-1");
    expect(enriched.site_url).toBe("https://voorbeeld.nl");
  });
});

describe("deliverOne — SSRF-guard", () => {
  it("weigert een loopback-IP in de URL (rejected, geen POST)", async () => {
    const { db, state } = makeState({ webhook: { url: "https://10.0.0.5/hook" } });
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "rejected", reason: "blocked-ip" });
    expect(state.delivery.status).toBe("rejected");
    expect(state.delivery.error).toContain("ssrf:");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("weigert localhost in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { db, state } = makeState({ webhook: { url: "http://localhost:3000/hook" } });
    const deliverer = delivererFor(db);

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "rejected", reason: "localhost" });
    vi.unstubAllEnvs();
  });

  it("staat localhost toe buiten production (dev)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { db, state } = makeState({ webhook: { url: "http://localhost:3000/hook" } });
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "ok" });
    expect(fetchFn).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("weigert een DNS-naam die naar een private IP resolved (anti-rebinding)", async () => {
    lookupMock.mockResolvedValue([
      { address: "169.254.169.254", family: 4 },
    ]);
    const { db, state } = makeState({
      webhook: { url: "https://evil.example.com/hook" },
    });
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "rejected", reason: "resolved-blocked-ip" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blokkeert een redirect naar een geblokkeerd IP (DNS-redirect-escape)", async () => {
    const { db, state } = makeState();
    const fetchFn = fetchWith(301, { location: "https://169.254.169.254/latest/meta-data" });
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "rejected", reason: "ssrf:blocked-ip" });
    expect(state.delivery.status).toBe("rejected");
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
  });
});

describe("deliverOne — retry/backoff en disable", () => {
  it("5xx → failed met backoff (1m na poging 1, 5m na poging 2) en failure_count", async () => {
    const { db, state } = makeState();
    const fetchFn = fetchWith(500);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    await deliverer.deliverOne(state.delivery.id);
    expect(state.delivery.status).toBe("failed");
    expect(state.delivery.attempts).toBe(1);
    expect(state.delivery.http_status).toBe(500);
    expect(state.delivery.next_attempt_at?.getTime()).toBe(NOW.getTime() + 60_000);
    expect(state.webhook.failure_count).toBe(1);

    await deliverer.deliverOne(state.delivery.id);
    expect(state.delivery.attempts).toBe(2);
    expect(state.delivery.next_attempt_at?.getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(state.webhook.failure_count).toBe(2);
  });

  it("na maxAttempts mislukte pogingen → delivery disabled + webhook uit + notificatie", async () => {
    const { db, state } = makeState();
    const fetchFn = fetchWith(500);
    const notify = vi.fn();
    const deliverer = createWebhookDeliverer({
      db,
      secretKey: KEY,
      log: () => {},
      now: () => NOW,
      fetchFn,
      notify,
      maxAttempts: 3,
    });

    const first = await deliverer.deliverOne(state.delivery.id);
    const second = await deliverer.deliverOne(state.delivery.id);
    const third = await deliverer.deliverOne(state.delivery.id);

    expect(first.status).toBe("failed");
    expect(second.status).toBe("failed");
    expect(third).toEqual({ status: "disabled" });
    expect(state.delivery.status).toBe("disabled");
    expect(state.delivery.attempts).toBe(3);
    expect(state.webhook.active).toBe(false);
    expect(notify).toHaveBeenCalledWith({
      type: "webhook_disabled",
      teamId: state.webhook.team_id,
      entityId: state.webhook.id,
      incidentId: state.webhook.id,
      payload: { webhook_name: state.webhook.name },
    });
  });

  it("test-deliveries mislukken zonder retry, disable of failure_count", async () => {
    const { db, state } = makeState({ delivery: { event: "test" } });
    const fetchFn = fetchWith(500);
    const notify = vi.fn();
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn, notify,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "failed" });
    expect(state.delivery.status).toBe("failed");
    expect(state.delivery.next_attempt_at).toBeNull();
    expect(state.webhook.active).toBe(true);
    expect(state.webhook.failure_count).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("deliverOne — permanente fouten", () => {
  it("404 → rejected zonder retry", async () => {
    const { db, state } = makeState();
    const fetchFn = fetchWith(404);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "rejected", reason: "http-404" });
    expect(state.delivery.status).toBe("rejected");
    expect(state.delivery.next_attempt_at).toBeNull();
    expect(state.webhook.failure_count).toBe(0);
    expect(state.webhook.last_http_status).toBe(404);
  });

  it("payload boven de 256 KB → rejected zonder POST", async () => {
    const { db, state } = makeState({
      delivery: { payload: { blob: "x".repeat(300 * 1024) } },
    });
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "rejected", reason: "payload-too-large" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("een inactieve webhook → delivery disabled zonder POST", async () => {
    const { db, state } = makeState({ webhook: { active: false } });
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const outcome = await deliverer.deliverOne(state.delivery.id);

    expect(outcome).toEqual({ status: "disabled" });
    expect(state.delivery.status).toBe("disabled");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("deliverDue", () => {
  it("pollt due rijen en telt de uitkomsten", async () => {
    const { db } = makeState();
    const fetchFn = fetchWith(200);
    const deliverer = createWebhookDeliverer({
      db, secretKey: KEY, log: () => {}, now: () => NOW, fetchFn,
    });

    const result = await deliverer.deliverDue();

    expect(result).toEqual({ attempted: 1, delivered: 1, rejected: 0, failed: 0, disabled: 0 });
  });

  it("geen due rijen → leeg resultaat", async () => {
    const state = fakePool(makeDelivery(), makeWebhook(), { dueRows: false });
    const deliverer = delivererFor(state.db);

    const result = await deliverer.deliverDue();

    expect(result).toEqual({ attempted: 0, delivered: 0, rejected: 0, failed: 0, disabled: 0 });
  });
});

describe("secret-encryptie", () => {
  it("rondje encrypt/decrypt met dezelfde key", () => {
    const secret = generateWebhookSecret();
    const stored = encryptWebhookSecret(KEY, secret);
    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decryptWebhookSecret(KEY, stored)).toBe(secret);
  });

  it("decrypt met de verkeerde key faalt", () => {
    const stored = encryptWebhookSecret(KEY, "geheim");
    expect(() => decryptWebhookSecret(generateSecretKey(), stored)).toThrow();
  });
});
