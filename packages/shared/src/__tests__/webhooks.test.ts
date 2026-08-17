import { describe, expect, it } from "vitest";
import {
  webhookCreateSchema,
  webhookDeliveriesListQuerySchema,
  webhookEnvelopeSchema,
  webhookEventTypeSchema,
  webhookEventsSchema,
  webhookUpdateSchema,
} from "../webhooks";
import { notificationTypes } from "../notifications";

describe("webhookEventTypeSchema", () => {
  it("bevat alle notificatie-types plus test", () => {
    const values = webhookEventTypeSchema.options as readonly string[];
    for (const type of notificationTypes) {
      expect(values).toContain(type);
    }
    expect(values).toContain("test");
    expect(values).toHaveLength(notificationTypes.length + 1);
  });

  it("accepteert elk notificatie-type en test", () => {
    for (const type of notificationTypes) {
      expect(webhookEventTypeSchema.safeParse(type).success).toBe(true);
    }
    expect(webhookEventTypeSchema.safeParse("test").success).toBe(true);
    expect(webhookEventTypeSchema.safeParse("onbekend").success).toBe(false);
  });
});

describe("webhookEventsSchema", () => {
  it("accepteert 1..8 unieke notificatie-types, nooit test", () => {
    expect(webhookEventsSchema.safeParse(["scan_done"]).success).toBe(true);
    expect(
      webhookEventsSchema.safeParse(["scan_done", "site_down", "score_drop"])
        .success,
    ).toBe(true);
    expect(webhookEventsSchema.safeParse([]).success).toBe(false);
    expect(webhookEventsSchema.safeParse(["test"]).success).toBe(false);
  });

  it("weigert dubbele events", () => {
    const result = webhookEventsSchema.safeParse(["scan_done", "scan_done"]);
    expect(result.success).toBe(false);
  });
});

describe("webhookCreateSchema", () => {
  const valid = {
    name: "CI-pipeline",
    url: "https://hooks.example.com/scanpal",
    events: ["scan_done", "score_drop"],
  };

  it("accepteert een geldige input", () => {
    expect(webhookCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("weigert een lege naam, ongeldige URL en lege events", () => {
    expect(
      webhookCreateSchema.safeParse({ ...valid, name: "" }).success,
    ).toBe(false);
    expect(
      webhookCreateSchema.safeParse({ ...valid, url: "geen-url" }).success,
    ).toBe(false);
    expect(
      webhookCreateSchema.safeParse({ ...valid, events: [] }).success,
    ).toBe(false);
  });
});

describe("webhookUpdateSchema", () => {
  it("accepteert deels lege updates", () => {
    expect(webhookUpdateSchema.safeParse({ active: false }).success).toBe(true);
    expect(
      webhookUpdateSchema.safeParse({ name: "anders", url: "https://x.dev" })
        .success,
    ).toBe(true);
  });

  it("weigert een lege update", () => {
    expect(webhookUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("webhookDeliveriesListQuerySchema", () => {
  it("parst query-strings naar limit/offset met defaults", () => {
    expect(webhookDeliveriesListQuerySchema.parse({})).toEqual({
      limit: 20,
      offset: 0,
    });
    expect(webhookDeliveriesListQuerySchema.parse({ limit: "5" })).toEqual({
      limit: 5,
      offset: 0,
    });
  });
});

describe("webhookEnvelopeSchema", () => {
  it("valideert de outbound envelop v1", () => {
    const envelope = {
      version: 1,
      id: "00000000-0000-4000-8000-000000000001",
      event: "scan_done",
      created_at: "2026-08-16T08:00:00.000Z",
      team_id: "00000000-0000-4000-8000-000000000002",
      data: { site_name: "voorbeeld.nl", score: 82 },
    };
    expect(webhookEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("weigert een fout versienummer of onbekend event", () => {
    const envelope = {
      version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      event: "onbekend",
      created_at: "2026-08-16T08:00:00.000Z",
      team_id: "00000000-0000-4000-8000-000000000002",
      data: {},
    };
    expect(webhookEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
