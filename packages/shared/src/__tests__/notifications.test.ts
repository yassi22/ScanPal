import { describe, it, expect } from "vitest";
import {
  notificationTypeSchema,
  notificationTypes,
  notificationViewSchema,
  notificationsListQuerySchema,
  notificationPreferenceUpdateSchema,
} from "../notifications";

describe("notifications schemas", () => {
  it("kent alle 11 types (incl. scan_diff, webhook_disabled, payment_failed, domain_alert)", () => {
    expect(notificationTypes).toEqual([
      "scan_done",
      "score_drop",
      "scan_diff",
      "site_down",
      "site_recovered",
      "critical_finding",
      "credit_skip",
      "scan_failed",
      "webhook_disabled",
      "payment_failed",
      "domain_alert",
    ]);
    for (const type of notificationTypes) {
      expect(notificationTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("weigert onbekende types", () => {
    expect(notificationTypeSchema.safeParse("sms").success).toBe(false);
  });

  it("valideert een notification-view", () => {
    const parsed = notificationViewSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      team_id: "00000000-0000-4000-8000-000000000002",
      type: "site_down",
      title: "Site down",
      body: "voorbeeld.nl is niet bereikbaar.",
      link: "/uptime/site-1",
      payload: { site_name: "voorbeeld.nl" },
      read_at: null,
      created_at: "2026-08-16T09:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("parseert query-filters inclusief coerce naar getallen", () => {
    const parsed = notificationsListQuerySchema.safeParse({
      limit: "10",
      offset: "20",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("parse mislukt");
    expect(parsed.data.limit).toBe(10);
    expect(parsed.data.offset).toBe(20);
  });

  it("weigert een limiet boven 50", () => {
    expect(
      notificationsListQuerySchema.safeParse({ limit: "100" }).success,
    ).toBe(false);
  });

  it("valideert een voorkeur-update", () => {
    const parsed = notificationPreferenceUpdateSchema.safeParse({
      type: "credit_skip",
      enabled: false,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("parse mislukt");
    expect(parsed.data.enabled).toBe(false);
  });
});
