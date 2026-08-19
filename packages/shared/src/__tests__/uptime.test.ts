import { describe, it, expect } from "vitest";
import {
  uptimeDetailSchema,
  uptimeEventSchema,
  uptimeHistoryQuerySchema,
  uptimeListResponseSchema,
  uptimeSummarySchema,
  updateUptimeMonitoringSchema,
} from "../uptime";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    site_id: "00000000-0000-4000-8000-000000000002",
    checked_at: "2026-08-16T09:00:00.000Z",
    status: "up",
    latency_ms: 120,
    status_code: 200,
    error: null,
    ...overrides,
  };
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    site_id: "00000000-0000-4000-8000-000000000002",
    url: "voorbeeld.nl",
    label: null,
    uptime_state: "up",
    uptime_state_changed_at: "2026-08-16T09:00:00.000Z",
    last_checked_at: "2026-08-16T09:01:00.000Z",
    probe_fresh: true,
    uptime_enabled: true,
    uptime_24h_pct: 99.96,
    uptime_30d_pct: 99.99,
    avg_latency_ms_24h: 110.5,
    p95_latency_ms_24h: 220,
    sparkline: [
      { at: "2026-08-16T08:00:00.000Z", up_pct: 100, avg_latency_ms: 100 },
    ],
    ...overrides,
  };
}

describe("uptimeEventSchema", () => {
  it("accepteert een geldige event", () => {
    expect(uptimeEventSchema.safeParse(makeEvent()).success).toBe(true);
  });

  it("verwerpt een ongeldige status", () => {
    const parsed = uptimeEventSchema.safeParse(makeEvent({ status: "unknown" }));
    expect(parsed.success).toBe(false);
  });

  it("laat latency/status_code/error null toe", () => {
    const parsed = uptimeEventSchema.safeParse(
      makeEvent({ latency_ms: null, status_code: null, error: "timeout" }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("uptimeSummarySchema", () => {
  it("accepteert een geldige summary met sparkline", () => {
    expect(uptimeSummarySchema.safeParse(makeSummary()).success).toBe(true);
  });

  it("verwerpt uptime-%-buiten 0–100", () => {
    const parsed = uptimeSummarySchema.safeParse(
      makeSummary({ uptime_24h_pct: 120 }),
    );
    expect(parsed.success).toBe(false);
  });

  it("staat null-percentages toe zolang er geen checks zijn", () => {
    const parsed = uptimeSummarySchema.safeParse(
      makeSummary({ uptime_24h_pct: null, uptime_30d_pct: null }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("uptimeDetailSchema", () => {
  it("accepteert summary + series + recent events + incident", () => {
    const parsed = uptimeDetailSchema.safeParse({
      summary: makeSummary(),
      series: [
        { at: "2026-08-16T08:00:00.000Z", up_pct: 100, avg_latency_ms: 90 },
      ],
      recent_events: [makeEvent()],
      last_incident: {
        started_at: "2026-08-15T10:00:00.000Z",
        ended_at: "2026-08-15T10:05:00.000Z",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("staat max 20 recent events toe", () => {
    const events = Array.from({ length: 21 }, (_, i) =>
      makeEvent({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` }),
    );
    const parsed = uptimeDetailSchema.safeParse({
      summary: makeSummary(),
      series: [],
      recent_events: events,
      last_incident: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("uptimeHistoryQuerySchema", () => {
  it("accepteert 30 en 90", () => {
    expect(uptimeHistoryQuerySchema.safeParse({ days: 30 }).success).toBe(true);
    expect(uptimeHistoryQuerySchema.safeParse({ days: 90 }).success).toBe(true);
  });

  it("verwerpt andere vensters", () => {
    expect(uptimeHistoryQuerySchema.safeParse({ days: 45 }).success).toBe(false);
    expect(uptimeHistoryQuerySchema.safeParse({ days: "abc" }).success).toBe(
      false,
    );
  });
});

describe("updateUptimeMonitoringSchema", () => {
  it("accepteert een boolean", () => {
    expect(
      updateUptimeMonitoringSchema.safeParse({ enabled: false }).success,
    ).toBe(true);
  });

  it("verwerpt geen boolean", () => {
    expect(
      updateUptimeMonitoringSchema.safeParse({ enabled: "ja" }).success,
    ).toBe(false);
  });
});

describe("uptimeListResponseSchema", () => {
  it("accepteert een lege lijst", () => {
    expect(uptimeListResponseSchema.safeParse({ sites: [] }).success).toBe(true);
  });
});
