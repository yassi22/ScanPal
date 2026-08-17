import { describe, it, expect } from "vitest";
import {
  PUBLIC_STATUS_SLUG_LENGTH,
  generatePublicStatusSlug,
  isValidPublicStatusSlug,
  publicErrorClass,
  publicStatusSchema,
} from "../public-status";

function makeStatus(overrides: Record<string, unknown> = {}) {
  return {
    site_host: "voorbeeld.nl",
    status: "up",
    uptime_30d: 99.98,
    uptime_90d: 99.99,
    series: [{ day: "2026-08-16", status: "up" }],
    incidents: [],
    ...overrides,
  };
}

describe("generatePublicStatusSlug", () => {
  it("genereert een 16-tekens hex-slug (URL-safe)", () => {
    const slug = generatePublicStatusSlug();
    expect(slug).toHaveLength(PUBLIC_STATUS_SLUG_LENGTH);
    expect(slug).toMatch(/^[0-9a-f]+$/);
  });

  it("genereert elke keer een unieke slug", () => {
    const slugs = new Set(
      Array.from({ length: 100 }, () => generatePublicStatusSlug()),
    );
    expect(slugs.size).toBe(100);
  });
});

describe("isValidPublicStatusSlug", () => {
  it("accepteert het generator-formaat", () => {
    expect(isValidPublicStatusSlug("a1b2c3d4e5f60718")).toBe(true);
  });

  it("verwerpt te korte, niet-hex en uppercase slugs", () => {
    expect(isValidPublicStatusSlug("abc")).toBe(false);
    expect(isValidPublicStatusSlug("xyz1234567890ab")).toBe(false);
    expect(isValidPublicStatusSlug("A1B2C3D4E5F60718")).toBe(false);
    expect(isValidPublicStatusSlug("a1b2c3d4-e5f6-0718")).toBe(false);
  });
});

describe("publicErrorClass", () => {
  it("geeft bekende probe-codes door", () => {
    expect(publicErrorClass("timeout")).toBe("timeout");
    expect(publicErrorClass("dns")).toBe("dns");
    expect(publicErrorClass("http-5xx")).toBe("http-5xx");
  });

  it("vlakt onbekende errors af naar other (geen intern lekkage)", () => {
    expect(publicErrorClass("ECONNREFUSED 203.0.113.1:443")).toBe("other");
    expect(publicErrorClass("certificate expired for www.example.com")).toBe(
      "other",
    );
  });

  it("geeft null bij geen error", () => {
    expect(publicErrorClass(null)).toBeNull();
    expect(publicErrorClass("")).toBeNull();
  });
});

describe("publicStatusSchema", () => {
  it("accepteert een geldige status", () => {
    expect(publicStatusSchema.safeParse(makeStatus()).success).toBe(true);
  });

  it("verwerpt findings/scores/team-data (onbekende keys worden gestript)", () => {
    const parsed = publicStatusSchema.safeParse(
      makeStatus({
        last_scan_score: 95,
        findings: [{ severity: "high" }],
        team_id: "team-1",
      }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("findings");
    expect(parsed.data).not.toHaveProperty("team_id");
    expect(parsed.data).not.toHaveProperty("last_scan_score");
  });

  it("verwerpt een ongeldige dag-status", () => {
    const parsed = publicStatusSchema.safeParse(
      makeStatus({ series: [{ day: "2026-08-16", status: "partial" }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("accepteert een lopend incident (end null)", () => {
    const parsed = publicStatusSchema.safeParse(
      makeStatus({
        incidents: [
          { start: "2026-08-16T08:00:00.000Z", end: null, error_class: "timeout" },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("verwerpt uptime-% buiten 0–100", () => {
    const parsed = publicStatusSchema.safeParse(makeStatus({ uptime_30d: 120 }));
    expect(parsed.success).toBe(false);
  });
});