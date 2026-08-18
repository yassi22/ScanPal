import { describe, expect, it } from "vitest";
import {
  mcpCheckCatalog,
  mcpDismissFindingInputSchema,
  mcpGetUptimeHistoryInputSchema,
  mcpListChecksInputSchema,
  mcpListFindingsInputSchema,
  mcpPaginationSchema,
  mcpToolDefinitions,
} from "../mcp-tools";

describe("mcpPaginationSchema", () => {
  it("default naar limit 50, offset 0", () => {
    expect(mcpPaginationSchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("accepteert strings via coerce", () => {
    expect(mcpPaginationSchema.parse({ limit: "10", offset: "5" })).toEqual({
      limit: 10,
      offset: 5,
    });
  });

  it("weigert limit boven 50 (plan-besluit: max 50 per call)", () => {
    expect(mcpPaginationSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(mcpPaginationSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(mcpPaginationSchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("mcpListFindingsInputSchema", () => {
  it("parseert alle filters inclusief route_url", () => {
    const parsed = mcpListFindingsInputSchema.parse({
      scan_id: "00000000-0000-4000-8000-000000000001",
      severity: "critical",
      category: "http",
      status: "open",
      route_url: "https://voorbeeld.nl/admin",
      q: "token",
      sort: "severity",
      order: "asc",
      limit: 25,
      offset: 50,
    });
    expect(parsed).toMatchObject({
      severity: "critical",
      category: "http",
      status: "open",
      route_url: "https://voorbeeld.nl/admin",
      limit: 25,
      offset: 50,
    });
  });

  it("weigert ongeldige severity en ontbrekende scan_id", () => {
    expect(
      mcpListFindingsInputSchema.safeParse({
        scan_id: "00000000-0000-4000-8000-000000000001",
        severity: "mega",
      }).success,
    ).toBe(false);
    expect(mcpListFindingsInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("mcpDismissFindingInputSchema", () => {
  it("accepteert fixed/ignored met note", () => {
    const parsed = mcpDismissFindingInputSchema.parse({
      scan_id: "00000000-0000-4000-8000-000000000001",
      finding_id: "https:https-ontbreekt",
      status: "ignored",
      note: "False positive — CDN-laag",
    });
    expect(parsed.note).toBe("False positive — CDN-laag");
  });

  it("weigert open (dismiss is alleen fixed/ignored) en ontbrekende note-limiet", () => {
    expect(
      mcpDismissFindingInputSchema.safeParse({
        scan_id: "00000000-0000-4000-8000-000000000001",
        finding_id: "https:https-ontbreekt",
        status: "open",
      }).success,
    ).toBe(false);
    expect(
      mcpDismissFindingInputSchema.safeParse({
        scan_id: "00000000-0000-4000-8000-000000000001",
        finding_id: "https:https-ontbreekt",
        status: "fixed",
        note: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("mcpGetUptimeHistoryInputSchema", () => {
  it("accepteert alleen 30 of 90 dagen, default 30", () => {
    expect(mcpGetUptimeHistoryInputSchema.parse({ site_id: "00000000-0000-4000-8000-000000000001" }).days).toBe(30);
    expect(
      mcpGetUptimeHistoryInputSchema.parse({
        site_id: "00000000-0000-4000-8000-000000000001",
        days: 90,
      }).days,
    ).toBe(90);
    expect(
      mcpGetUptimeHistoryInputSchema.safeParse({
        site_id: "00000000-0000-4000-8000-000000000001",
        days: 14,
      }).success,
    ).toBe(false);
  });
});

describe("mcpListChecksInputSchema", () => {
  it("heeft geen input", () => {
    expect(mcpListChecksInputSchema.parse({})).toEqual({});
  });
});

describe("mcpToolDefinitions", () => {
  it("registreert 14 tools met unieke namen", () => {
    expect(mcpToolDefinitions).toHaveLength(14);
    const names = mcpToolDefinitions.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "run_scan",
      "get_scan",
      "get_findings",
      "list_findings",
      "get_finding",
      "dismiss_finding",
      "get_scan_diff",
      "list_scans",
      "list_sites",
      "get_site",
      "get_uptime",
      "get_uptime_history",
      "generate_fix_prompt",
      "list_checks",
    ]);
  });

  it("heeft per tool title, description, input- en output-schema", () => {
    for (const tool of mcpToolDefinitions) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("bevat de 8 nieuwe tools uit plan 63", () => {
    for (const name of [
      "list_findings",
      "get_finding",
      "dismiss_finding",
      "get_scan_diff",
      "list_scans",
      "get_site",
      "get_uptime_history",
      "list_checks",
    ]) {
      expect(mcpToolDefinitions.map((tool) => tool.name)).toContain(name);
    }
  });

  it("list_checks leest de check-catalog uit shared (single source of truth)", () => {
    const tool = mcpToolDefinitions.find((t) => t.name === "list_checks")!;
    expect(mcpCheckCatalog.length).toBeGreaterThan(0);
    expect(tool.outputSchema.safeParse(mcpCheckCatalog).success).toBe(true);
  });

  it("dismiss_finding is de enige schrijftool", () => {
    const writeTools = mcpToolDefinitions.filter((tool) =>
      /dismiss|delete|cancel|create|update|set|remove/.test(tool.name),
    );
    expect(writeTools.map((tool) => tool.name)).toEqual(["dismiss_finding"]);
  });
});
