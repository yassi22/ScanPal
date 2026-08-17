import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listGet } from "@/app/api/notifications/route";
import { POST as readPost } from "@/app/api/notifications/[id]/read/route";
import { POST as readAllPost } from "@/app/api/notifications/read-all/route";
import {
  GET as prefsGet,
  PATCH as prefsPatch,
} from "@/app/api/notifications/preferences/route";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

const queryMock = vi.mocked(pool.query);
const getUserMock = vi.mocked(getSessionUser);

const USER = { id: "00000000-0000-4000-8000-00000000000a" };
const TEAM_ID = "00000000-0000-4000-8000-00000000000b";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000011";
const SECOND_ID = "00000000-0000-4000-8000-000000000022";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    team_id: TEAM_ID,
    type: "score_drop",
    title: "Score gedaald",
    body: "De scan-score van voorbeeld.nl is gedaald.",
    link: "/scans/scan-1",
    payload: { site_name: "voorbeeld.nl" },
    read_at: null,
    created_at: new Date("2026-08-16T09:00:00Z"),
    ...overrides,
  };
}

describe("GET /api/notifications", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await listGet(new NextRequest("http://localhost/api/notifications"));
    expect(response.status).toBe(401);
  });

  it("geeft 400 bij een onbekend type-filter", async () => {
    const response = await listGet(
      new NextRequest("http://localhost/api/notifications?type=onbekend"),
    );
    expect(response.status).toBe(400);
  });

  it("retourneert de lijst met unread + total tellingen", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [makeRow(), makeRow({ id: SECOND_ID, read_at: new Date("2026-08-16T08:00:00Z") })],
    } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ total: 7, unread: 3 }],
    } as never);

    const response = await listGet(
      new NextRequest("http://localhost/api/notifications?limit=2&offset=0"),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0]).toMatchObject({
      id: NOTIFICATION_ID,
      type: "score_drop",
      read_at: null,
      created_at: "2026-08-16T09:00:00.000Z",
    });
    expect(body.unread).toBe(3);
    expect(body.total).toBe(7);
  });

  it("filtert op ongelezen", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ total: 1, unread: 0 }],
    } as never);

    await listGet(new NextRequest("http://localhost/api/notifications?unread=true"));

    const calls = queryMock.mock.calls;
    const listCall = calls.find(([sql]) => (sql as string).includes("order by created_at desc"));
    expect(listCall).toBeDefined();
    expect(listCall?.[0]).toContain("read_at is null");
  });
});

describe("POST /api/notifications/[id]/read", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await readPost(new NextRequest("http://localhost/read"), {
      params: Promise.resolve({ id: NOTIFICATION_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("geeft 404 als de melding niet van de gebruiker is", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const response = await readPost(new NextRequest("http://localhost/read"), {
      params: Promise.resolve({ id: NOTIFICATION_ID }),
    });
    expect(response.status).toBe(404);
  });

  it("markeert de melding als gelezen (idempotent)", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [makeRow({ read_at: new Date("2026-08-16T10:00:00Z") })],
    } as never);

    const response = await readPost(new NextRequest("http://localhost/read"), {
      params: Promise.resolve({ id: NOTIFICATION_ID }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.notification.id).toBe(NOTIFICATION_ID);
    expect(body.notification.read_at).toBe("2026-08-16T10:00:00.000Z");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("update notifications"),
      [NOTIFICATION_ID, USER.id],
    );
  });
});

describe("POST /api/notifications/read-all", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await readAllPost();
    expect(response.status).toBe(401);
  });

  it("markeert alle ongelezen meldingen als gelezen", async () => {
    queryMock.mockResolvedValue({ rowCount: 4, rows: [] } as never);
    const response = await readAllPost();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 4 });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("read_at is null"),
      [USER.id],
    );
  });
});

describe("GET/PATCH /api/notifications/preferences", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue(USER as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("geeft 401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await prefsGet();
    expect(response.status).toBe(401);
  });

  it("retourneert alle types met opgeslagen + default waarden", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ type: "scan_done", enabled: true }],
    } as never);

    const response = await prefsGet();
    expect(response.status).toBe(200);

    const body = await response.json();
    const byType = new Map(
      body.preferences.map((p: { type: string; enabled: boolean }) => [p.type, p.enabled]),
    );
    expect(byType.size).toBe(10);
    expect(byType.get("scan_done")).toBe(true);
    expect(byType.get("score_drop")).toBe(true);
    expect(byType.get("site_down")).toBe(true);
    expect(byType.get("scan_failed")).toBe(true);
    expect(byType.get("webhook_disabled")).toBe(true);
    expect(byType.get("payment_failed")).toBe(true);
    expect(byType.get("domain_alert")).toBe(true);
  });

  it("geeft 400 bij ongeldige PATCH-body", async () => {
    const response = await prefsPatch(
      new NextRequest("http://localhost/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "onbekend", enabled: true }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("upsert een voorkeur en retourneert de nieuwe lijst", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] } as never);
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ type: "scan_done", enabled: false }],
    } as never);

    const response = await prefsPatch(
      new NextRequest("http://localhost/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "scan_done", enabled: false }),
      }),
    );
    expect(response.status).toBe(200);

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("on conflict (user_id, type)"),
      [USER.id, "scan_done", false],
    );
    const body = await response.json();
    expect(body.preferences.find((p: { type: string }) => p.type === "scan_done").enabled).toBe(false);
  });
});
