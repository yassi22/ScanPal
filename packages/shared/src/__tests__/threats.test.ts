import { describe, expect, it } from "vitest";
import {
  honeypotSetupResponseSchema,
  threatEventSchema,
  threatEventsQuerySchema,
  threatEventsResponseSchema,
  threatHoneypotViewSchema,
  threatOverviewResponseSchema,
  threatOverviewSchema,
  updateHoneypotSchema,
} from "../threats";

const EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  team_id: "00000000-0000-4000-8000-000000000002",
  site_id: "00000000-0000-4000-8000-000000000003",
  honeypot_id: "00000000-0000-4000-8000-000000000004",
  kind: "hit",
  risk: "low",
  path: "/h/token",
  ip: "203.0.113.10",
  user_agent: "Mozilla/5.0",
  country: null,
  asn: null,
  matched_rule: null,
  payload: {},
  created_at: "2026-08-16T10:00:00.000Z",
};

function makeEvent(overrides: Record<string, unknown> = {}) {
  return { ...EVENT, ...overrides };
}

function makeHoneypot(overrides: Record<string, unknown> = {}) {
  return {
    site_id: "00000000-0000-4000-8000-000000000003",
    site_url: "voorbeeld.nl",
    site_label: null,
    honeypot_id: "00000000-0000-4000-8000-000000000004",
    enabled: true,
    url: "https://scanpal.app/h/abc123",
    path: "/h/abc123",
    hit_count: 12,
    created_at: "2026-08-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("threatEventSchema", () => {
  it("accepteert een geldige hit", () => {
    expect(threatEventSchema.safeParse(makeEvent()).success).toBe(true);
  });

  it("accepteert een pattern-event met matched_rule", () => {
    const parsed = threatEventSchema.safeParse(
      makeEvent({ kind: "pattern", risk: "high", matched_rule: "path_env" }),
    );
    expect(parsed.success).toBe(true);
  });

  it("verwerpt een onbekende risk", () => {
    const parsed = threatEventSchema.safeParse(makeEvent({ risk: "fatal" }));
    expect(parsed.success).toBe(false);
  });

  it("verwerpt een onbekende rule_key in matched_rule", () => {
    const parsed = threatEventSchema.safeParse(
      makeEvent({ kind: "pattern", matched_rule: "silly" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("laat ip/user_agent/country/asn null toe", () => {
    const parsed = threatEventSchema.safeParse(
      makeEvent({ ip: null, user_agent: null, country: null, asn: null }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("threatHoneypotViewSchema", () => {
  it("accepteert een geldige view", () => {
    expect(threatHoneypotViewSchema.safeParse(makeHoneypot()).success).toBe(
      true,
    );
  });

  it("verwerpt een negatieve hit_count", () => {
    const parsed = threatHoneypotViewSchema.safeParse(
      makeHoneypot({ hit_count: -1 }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("threatOverviewSchema", () => {
  it("accepteert een overzicht met last_event en active_patterns", () => {
    const parsed = threatOverviewSchema.safeParse({
      site: makeHoneypot(),
      last_event: makeEvent({ kind: "pattern", matched_rule: "burst" }),
      high_risk_count: 3,
      active_patterns: ["burst", "path_env"],
    });
    expect(parsed.success).toBe(true);
  });

  it("staat een overzicht zonder events toe", () => {
    const parsed = threatOverviewSchema.safeParse({
      site: makeHoneypot(),
      last_event: null,
      high_risk_count: 0,
      active_patterns: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("verwerpt een onbekend patroon", () => {
    const parsed = threatOverviewSchema.safeParse({
      site: makeHoneypot(),
      last_event: null,
      high_risk_count: 0,
      active_patterns: ["nope"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("threatOverviewResponseSchema", () => {
  it("accepteert een lege lijst", () => {
    expect(threatOverviewResponseSchema.safeParse({ sites: [] }).success).toBe(
      true,
    );
  });
});

describe("threatEventsQuerySchema", () => {
  it("geeft defaults voor page/page_size", () => {
    const parsed = threatEventsQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.page_size).toBe(25);
    }
  });

  it("accepteert filters", () => {
    const parsed = threatEventsQuerySchema.safeParse({
      site_id: "00000000-0000-4000-8000-000000000003",
      risk: "high",
      kind: "pattern",
      page: 2,
      page_size: 50,
    });
    expect(parsed.success).toBe(true);
  });

  it("verwerpt een onbekende risk-filter", () => {
    const parsed = threatEventsQuerySchema.safeParse({ risk: "fatal" });
    expect(parsed.success).toBe(false);
  });
});

describe("threatEventsResponseSchema", () => {
  it("accepteert events + total", () => {
    const parsed = threatEventsResponseSchema.safeParse({
      events: [makeEvent()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("updateHoneypotSchema", () => {
  it("accepteert enable/disable", () => {
    expect(updateHoneypotSchema.safeParse({ enabled: false }).success).toBe(
      true,
    );
  });

  it("defaults rotate_token naar false", () => {
    const parsed = updateHoneypotSchema.safeParse({ enabled: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rotate_token).toBe(false);
    }
  });

  it("verwerpt ontbrekende enabled", () => {
    expect(updateHoneypotSchema.safeParse({}).success).toBe(false);
  });
});

describe("honeypotSetupResponseSchema", () => {
  it("accepteert honeypot + snippet", () => {
    const parsed = honeypotSetupResponseSchema.safeParse({
      honeypot: makeHoneypot(),
      snippet: {
        html: "<a href=\"https://scanpal.app/h/abc123\">.</a>",
        url: "https://scanpal.app/h/abc123",
      },
    });
    expect(parsed.success).toBe(true);
  });
});
