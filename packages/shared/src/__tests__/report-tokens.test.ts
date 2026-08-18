import { describe, it, expect } from "vitest";
import { brandingSchema } from "../branding";
import {
  generateReportToken,
  isValidReportToken,
  reportTokenSchema,
} from "../report-tokens";
import { createWorkspaceSchema, workspaceSchema } from "../workspaces";

const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

describe("generateReportToken (contract)", () => {
  it("geeft exact 32 lowercase hex-tekens", () => {
    const token = generateReportToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(token).toHaveLength(32);
  });

  it("is uniek over 1000 calls", () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => generateReportToken()),
    );
    expect(tokens.size).toBe(1000);
  });
});

describe("isValidReportToken", () => {
  it("accepteert een geldig token", () => {
    expect(isValidReportToken(VALID_TOKEN)).toBe(true);
    expect(isValidReportToken(generateReportToken())).toBe(true);
  });

  it("verwerpt verkeerde lengte", () => {
    expect(isValidReportToken(VALID_TOKEN.slice(0, 31))).toBe(false);
    expect(isValidReportToken(VALID_TOKEN + "f")).toBe(false);
    expect(isValidReportToken("")).toBe(false);
  });

  it("verwerpt uppercase", () => {
    expect(isValidReportToken(VALID_TOKEN.toUpperCase())).toBe(false);
  });

  it("verwerpt niet-hex tekens", () => {
    expect(isValidReportToken("g".repeat(32))).toBe(false);
    expect(isValidReportToken("z".repeat(32))).toBe(false);
  });
});

describe("reportTokenSchema (contract)", () => {
  it("accepteert een token zonder expires_at", () => {
    expect(reportTokenSchema.safeParse({ token: VALID_TOKEN }).success).toBe(
      true,
    );
  });

  it("accepteert expires_at als ISO-datetime of null", () => {
    expect(
      reportTokenSchema.safeParse({
        token: VALID_TOKEN,
        expires_at: "2026-12-31T23:59:59Z",
      }).success,
    ).toBe(true);
    expect(
      reportTokenSchema.safeParse({ token: VALID_TOKEN, expires_at: null })
        .success,
    ).toBe(true);
  });

  it("verwerpt een ongeldig token", () => {
    expect(reportTokenSchema.safeParse({ token: "niet-32-hex" }).success).toBe(
      false,
    );
    expect(
      reportTokenSchema.safeParse({ token: VALID_TOKEN.toUpperCase() }).success,
    ).toBe(false);
    expect(reportTokenSchema.safeParse({}).success).toBe(false);
  });
});

describe("brandingSchema (contract)", () => {
  it("accepteert {} (de DB-default)", () => {
    expect(brandingSchema.safeParse({}).success).toBe(true);
  });

  it("accepteert een volledig branding-object", () => {
    const branding = {
      logo_url: "https://example.com/logo.png",
      primary_color: "#FF0000",
      report_name: "Acme Security Rapport",
      hide_branding: true,
    };
    expect(brandingSchema.safeParse(branding).success).toBe(true);
  });

  it("verwerpt een ongeldige primary_color", () => {
    expect(brandingSchema.safeParse({ primary_color: "red" }).success).toBe(
      false,
    );
    expect(brandingSchema.safeParse({ primary_color: "#12345" }).success).toBe(
      false,
    );
  });

  it("verwerpt een ongeldige logo_url", () => {
    expect(brandingSchema.safeParse({ logo_url: "geen-url" }).success).toBe(
      false,
    );
  });
});

describe("workspaceSchemas (contract)", () => {
  it("accepteert een geldige create-workspace", () => {
    expect(createWorkspaceSchema.safeParse({ name: "Marketing" }).success).toBe(
      true,
    );
  });

  it("verwerpt lege of te lange namen", () => {
    expect(createWorkspaceSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "x".repeat(81) }).success).toBe(
      false,
    );
  });

  it("valideert de volledige DB-rij", () => {
    const row = {
      id: "a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b",
      parent_team_id: "a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b",
      name: "Marketing",
      created_at: "2026-08-18T10:00:00Z",
    };
    expect(workspaceSchema.safeParse(row).success).toBe(true);
  });
});
