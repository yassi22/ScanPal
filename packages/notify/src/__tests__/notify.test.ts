import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Pool } from "pg";
import { createNotifier, type NotifyInput } from "../index";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

type Recipient = {
  user_id: string;
  email: string;
  pref_enabled: boolean | null;
};

type NotificationRow = {
  team_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  payload: string;
  dedup_key: string;
};

type DeliveryRow = {
  webhook_id: string;
  event: string;
  payload: string;
  dedup_key: string;
};

function fakePool() {
  const recipients: Recipient[] = [];
  const rows: NotificationRow[] = [];
  const webhookIds: string[] = [];
  const deliveries: DeliveryRow[] = [];

  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();

      if (text.startsWith("select u.id as user_id")) {
        return { rowCount: recipients.length, rows: recipients };
      }

      if (text.startsWith("select id from webhooks")) {
        const webhooks = webhookIds.map((id) => ({ id }));
        return { rowCount: webhooks.length, rows: webhooks };
      }

      if (text.startsWith("insert into webhook_deliveries")) {
        const [webhookId, event, payload, key] = params as string[];
        if (deliveries.some((d) => d.dedup_key === key)) {
          return { rowCount: 0, rows: [] };
        }
        deliveries.push({ webhook_id: webhookId, event, payload, dedup_key: key });
        return { rowCount: 1, rows: [{ id: `w-${deliveries.length}` }] };
      }

      if (text.startsWith("insert into notifications")) {
        const [teamId, userId, type, title, body, link, payload, key] =
          params as string[];
        if (rows.some((r) => r.dedup_key === key)) {
          return { rowCount: 0, rows: [] };
        }
        rows.push({
          team_id: teamId,
          user_id: userId,
          type,
          title,
          body,
          link,
          payload,
          dedup_key: key,
        });
        return { rowCount: 1, rows: [{ id: `n-${rows.length}` }] };
      }

      throw new Error(`onbekende query in test-fake: ${text}`);
    },
  };

  return { db: db as unknown as Pool, rows, recipients, webhookIds, deliveries };
}

function baseInput(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    type: "score_drop",
    teamId: "team-1",
    entityId: "scan-1",
    payload: { site_name: "voorbeeld.nl", previous_score: 88, new_score: 60 },
    ...overrides,
  };
}

function notifierFor(state: ReturnType<typeof fakePool>) {
  return createNotifier({
    db: state.db,
    resendApiKey: "test-key",
    resendFrom: "ScanPal <no-reply@scanpal.dev>",
    appUrl: "https://app.scanpal.dev",
    log: () => {},
  });
}

function sentEmails() {
  return sendMock.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ error: null });
});

describe("createNotifier", () => {
  it("stuurt in-app rijen + e-mail naar alle teamleden met default voorkeuren", async () => {
    const state = fakePool();
    state.recipients.push(
      { user_id: "u1", email: "a@example.com", pref_enabled: null },
      { user_id: "u2", email: "b@example.com", pref_enabled: null },
    );

    const result = await notifierFor(state)(baseInput());

    expect(result).toEqual({
      recipients: 2,
      inserted: 2,
      deduped: 0,
      emailsSent: 2,
      emailsFailed: 0,
      outboxQueued: 0,
    });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]).toMatchObject({
      team_id: "team-1",
      user_id: "u1",
      type: "score_drop",
      title: "Score gedaald",
      link: "/scans/scan-1",
      dedup_key: "score_drop:u1:scan-1:",
    });
    const emails = sentEmails();
    expect(emails.map((e) => e.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(emails[0].subject).toBe("Score gedaald: voorbeeld.nl");
    expect(emails[0].from).toBe("ScanPal <no-reply@scanpal.dev>");
    expect(emails[0].html).toContain("https://app.scanpal.dev/scans/scan-1");
  });

  it("scan_done is standaard uit: geen in-app rij en geen e-mail", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });

    const result = await notifierFor(state)(
      baseInput({ type: "scan_done", payload: { site_name: "voorbeeld.nl", score: 82 } }),
    );

    expect(result.inserted).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(state.rows).toHaveLength(0);
    expect(sentEmails()).toHaveLength(0);
  });

  it("een uitgezette voorkeur onderdrukt zowel rij als e-mail", async () => {
    const state = fakePool();
    state.recipients.push(
      { user_id: "u1", email: "a@example.com", pref_enabled: null },
      { user_id: "u2", email: "b@example.com", pref_enabled: false },
    );

    const result = await notifierFor(state)(baseInput());

    expect(result.inserted).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(state.rows.map((r) => r.user_id)).toEqual(["u1"]);
    expect(sentEmails().map((e) => e.to)).toEqual(["a@example.com"]);
  });

  it("een aangeschakelde voorkeur zet scan_done wél aan", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: true });

    const result = await notifierFor(state)(
      baseInput({ type: "scan_done", payload: { site_name: "voorbeeld.nl", score: 90 } }),
    );

    expect(result.emailsSent).toBe(1);
    expect(sentEmails()[0].subject).toBe("Scan voltooid: voorbeeld.nl");
  });

  it("dedup: een tweede aanroep met dezelfde key doet niets", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    const notify = notifierFor(state);

    const first = await notify(baseInput());
    const second = await notify(baseInput());

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.deduped).toBe(1);
    expect(second.emailsSent).toBe(0);
    expect(state.rows).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
  });

  it("site_down gebruikt incidentId in de dedup-key (1× per incident)", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    const notify = notifierFor(state);

    const first = await notify(
      baseInput({ type: "site_down", entityId: "site-1", incidentId: "ts-1" }),
    );
    const second = await notify(
      baseInput({ type: "site_down", entityId: "site-1", incidentId: "ts-2" }),
    );

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(1);
    expect(state.rows.map((r) => r.dedup_key)).toEqual([
      "site_down:u1:site-1:ts-1",
      "site_down:u1:site-1:ts-2",
    ]);
    expect(state.rows[0].link).toBe("/uptime/site-1");
  });

  it("site-naam met HTML wordt geëscaped in de e-mail", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });

    await notifierFor(state)(
      baseInput({ payload: { site_name: "<script>alert(1)</script>" } }),
    );

    const html = sentEmails()[0].html as string;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("geen teamleden → leeg resultaat zonder queries naar de mailer", async () => {
    const state = fakePool();
    const result = await notifierFor(state)(baseInput());

    expect(result).toEqual({
      recipients: 0,
      inserted: 0,
      deduped: 0,
      emailsSent: 0,
      emailsFailed: 0,
      outboxQueued: 0,
    });
    expect(sentEmails()).toHaveLength(0);
  });

  it("payment_failed is default aan en linkt naar billing", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    const notify = notifierFor(state);

    const result = await notify(
      baseInput({
        type: "payment_failed",
        entityId: "in_1",
        payload: { amount_due: "€29,04" },
      }),
    );

    expect(result.inserted).toBe(1);
    expect(state.rows[0].title).toBe("Betalingsfout");
    expect(state.rows[0].link).toBe("/billing");
    expect(state.rows[0].dedup_key).toBe("payment_failed:u1:in_1:");
  });

  it("een mislukte e-mail breekt de hub niet (rij blijft staan)", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    sendMock.mockRejectedValueOnce(new Error("network down"));

    const result = await notifierFor(state)(baseInput());

    expect(result.inserted).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    expect(state.rows).toHaveLength(1);
  });

  it("zonder RESEND_API_KEY wordt er geen e-mail verstuurd", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    const notify = createNotifier({ db: state.db });

    const result = await notify(baseInput());

    expect(result.inserted).toBe(1);
    expect(result.emailsSent).toBe(1); // geen sleutel = bewust doorlopen zonder echte send
    expect(sentEmails()).toHaveLength(0);
  });

  it("gooit bij een onbekend type", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });

    await expect(
      notifierFor(state)({ ...baseInput(), type: "onbekend" as never }),
    ).rejects.toThrow("Onbekend notificatie-type");
  });
});

describe("webhook-kanaal (plan 15)", () => {
  function webhookNotifierFor(state: ReturnType<typeof fakePool>) {
    return createNotifier({
      db: state.db,
      resendApiKey: "test-key",
      appUrl: "https://app.scanpal.dev",
      log: () => {},
    });
  }

  it("schrijft één outbox-rij per enabled webhook die dit event selecteert", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    state.webhookIds.push("wh-1", "wh-2");

    const result = await webhookNotifierFor(state)(baseInput());

    expect(result.outboxQueued).toBe(2);
    expect(state.deliveries).toHaveLength(2);
    expect(state.deliveries[0]).toEqual({
      webhook_id: "wh-1",
      event: "score_drop",
      payload: JSON.stringify(baseInput().payload),
      dedup_key: "score_drop:wh-1:scan-1:",
    });
    expect(state.deliveries[1].webhook_id).toBe("wh-2");
  });

  it("dedup: een tweede aanroep met dezelfde key voegt geen rij toe", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });
    state.webhookIds.push("wh-1");
    const notify = webhookNotifierFor(state);

    const first = await notify(baseInput());
    const second = await notify(baseInput());

    expect(first.outboxQueued).toBe(1);
    expect(second.outboxQueued).toBe(0);
    expect(state.deliveries).toHaveLength(1);
  });

  it("webhooks zijn team-breed: voorkeuren van users tellen niet mee", async () => {
    const state = fakePool();
    // alle gebruikers zetten scan_done uit, maar de webhook krijgt wél een rij
    state.recipients.push(
      { user_id: "u1", email: "a@example.com", pref_enabled: false },
      { user_id: "u2", email: "b@example.com", pref_enabled: false },
    );
    state.webhookIds.push("wh-1");

    const result = await webhookNotifierFor(state)(
      baseInput({ type: "scan_done", payload: { site_name: "voorbeeld.nl", score: 90 } }),
    );

    expect(result.inserted).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.outboxQueued).toBe(1);
    expect(state.deliveries[0].event).toBe("scan_done");
  });

  it("geen webhooks → geen outbox-rijen", async () => {
    const state = fakePool();
    state.recipients.push({ user_id: "u1", email: "a@example.com", pref_enabled: null });

    const result = await webhookNotifierFor(state)(baseInput());

    expect(result.outboxQueued).toBe(0);
    expect(state.deliveries).toHaveLength(0);
  });

  it("zonder teamleden worden webhooks wél gequeued", async () => {
    const state = fakePool();
    state.webhookIds.push("wh-1");

    const result = await webhookNotifierFor(state)(baseInput());

    expect(result.recipients).toBe(0);
    expect(result.outboxQueued).toBe(1);
  });
});
