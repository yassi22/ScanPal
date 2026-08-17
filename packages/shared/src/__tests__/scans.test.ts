import { describe, it, expect } from "vitest";
import {
  scanListItemSchema,
  scanSchema,
} from "../scans";
import { scanProgressEventSchema } from "../scan-progress";
import { scanStatusSchema, siteWithStatusSchema } from "../sites";

const SCAN_ID = "00000000-0000-4000-8000-000000000001";
const SITE_ID = "00000000-0000-4000-8000-000000000002";

describe("scanStatusSchema", () => {
  it("accepteert canceled naast de bestaande statussen", () => {
    for (const status of [
      "queued",
      "running",
      "completed",
      "failed",
      "canceled",
    ]) {
      expect(scanStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("weigert onbekende statussen", () => {
    expect(scanStatusSchema.safeParse("cancelled").success).toBe(false);
    expect(scanStatusSchema.safeParse("done").success).toBe(false);
  });
});

describe("scanSchema / scanListItemSchema", () => {
  const base = {
    id: SCAN_ID,
    site_id: SITE_ID,
    status: "canceled",
    progress: 0,
    score: null,
    findings: {},
    trigger: "manual",
    scheduled_for: null,
    created_at: "2026-08-16T09:00:00.000Z",
    completed_at: null,
  };

  it("accepteert een gecancelde scan", () => {
    expect(scanSchema.safeParse(base).success).toBe(true);
  });

  it("accepteert een gecancelde scan-lijst-rij", () => {
    const listItem = {
      ...base,
      site_url: "example.com",
      site_label: null,
    };
    expect(scanListItemSchema.safeParse(listItem).success).toBe(true);
  });
});

describe("siteWithStatusSchema.last_scan_status", () => {
  it("accepteert canceled als last_scan_status", () => {
    const site = {
      id: SITE_ID,
      team_id: "00000000-0000-4000-8000-000000000003",
      url: "example.com",
      github_repo: null,
      label: null,
      public_status_slug: null,
      github_webhook_configured: false,
      last_scan_id: null,
      last_scan_status: "canceled",
      last_scan_score: null,
      last_scanned_at: "2026-08-16T09:00:00.000Z",
      uptime_state: "unknown",
      scan_frequency: "none",
      next_scan_at: null,
      created_at: "2026-08-16T09:00:00.000Z",
    };
    expect(siteWithStatusSchema.safeParse(site).success).toBe(true);
  });
});

describe("scanProgressEventSchema", () => {
  it("accepteert het canceled-event-contract", () => {
    const event = {
      event: "canceled",
      scan_id: SCAN_ID,
      status: "canceled",
    };
    const parsed = scanProgressEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.event).toBe("canceled");
  });

  it("weigert een canceled-event met verkeerde status", () => {
    expect(
      scanProgressEventSchema.safeParse({
        event: "canceled",
        scan_id: SCAN_ID,
        status: "running",
      }).success,
    ).toBe(false);
  });

  it("behoudt de bestaande progress/completed/failed-varianten", () => {
    expect(
      scanProgressEventSchema.safeParse({
        event: "progress",
        scan_id: SCAN_ID,
        status: "running",
        progress: {
          overall: 50,
          checks_done: 2,
          checks_total: 4,
          categories: {
            http: {
              status: "running",
              done: 2,
              total: 3,
              percent: 67,
              current_check: null,
            },
            seo: {
              status: "pending",
              done: 0,
              total: 0,
              percent: 0,
              current_check: null,
            },
            aeo: {
              status: "pending",
              done: 0,
              total: 0,
              percent: 0,
              current_check: null,
            },
            github: {
              status: "pending",
              done: 0,
              total: 0,
              percent: 0,
              current_check: null,
            },
          },
        },
      }).success,
    ).toBe(true);
    expect(
      scanProgressEventSchema.safeParse({
        event: "completed",
        scan_id: SCAN_ID,
        status: "completed",
        score: 88,
        summary: { critical: 0, high: 1, medium: 0, low: 0, info: 2 },
      }).success,
    ).toBe(true);
    expect(
      scanProgressEventSchema.safeParse({
        event: "failed",
        scan_id: SCAN_ID,
        status: "failed",
        error: "netwerkfout",
      }).success,
    ).toBe(true);
  });
});