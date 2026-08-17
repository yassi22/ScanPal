import { describe, it, expect } from "vitest";
import {
  decodeReportCursor,
  encodeReportCursor,
  reportDataSchema,
  reportFormatSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  reportMetaSchema,
  type ReportData,
  type ReportMeta,
} from "../index";

const NOW = "2026-08-15T09:00:00.000Z";

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    scan: {
      id: "00000000-0000-4000-8000-000000000001",
      trigger: "manual",
      created_at: NOW,
      completed_at: NOW,
    },
    site: { url: "example.com", label: null },
    score: 80,
    category_scores: {
      http: 100,
      seo: 67,
      aeo: null,
      github: null,
      compliance: null,
    },
    summary: { critical: 1, high: 2, medium: 0, low: 0, info: 3 },
    findings: [
      {
        id: "check:title",
        check_id: "check",
        category: "http",
        severity: "high",
        title: "HTTPS ontbreekt",
        description: "Geen TLS",
        remediation: "Regel een certificaat",
        evidence: "curl resultaat",
        active: false,
        status: "open",
        note: null,
        created_at: NOW,
        route_url: null,
        regressed: false,
        snooze_until: null,
      },
    ],
    ...overrides,
  };
}

function makeReportMeta(overrides: Partial<ReportMeta> = {}): ReportMeta {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    site_id: "00000000-0000-4000-8000-000000000002",
    scan_id: "00000000-0000-4000-8000-000000000001",
    format: "md",
    filename: "scanpal-example-com-2026-08-15.md",
    size_bytes: 1024,
    created_at: NOW,
    ...overrides,
  };
}

describe("reportFormatSchema", () => {
  it("accepteert alleen md en pdf", () => {
    expect(reportFormatSchema.safeParse("md").success).toBe(true);
    expect(reportFormatSchema.safeParse("pdf").success).toBe(true);
    expect(reportFormatSchema.safeParse("docx").success).toBe(false);
  });
});

describe("reportDataSchema", () => {
  it("parset geldige rapport-data", () => {
    const parsed = reportDataSchema.safeParse(makeReportData());
    expect(parsed.success).toBe(true);
  });

  it("weigert een non-completed scan zonder score of datum", () => {
    const data = makeReportData({ score: 101 as never });
    expect(reportDataSchema.safeParse(data).success).toBe(false);
    expect(
      reportDataSchema.safeParse(
        makeReportData({ scan: { ...makeReportData().scan, completed_at: "later" as never } }),
      ).success,
    ).toBe(false);
  });

  it("valideert findings met het findingSchema (incl. defaults)", () => {
    const data = makeReportData();
    data.findings[0] = { ...data.findings[0], status: undefined } as never;
    const parsed = reportDataSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.findings[0].status).toBe("open");
  });
});

describe("reportMetaSchema + reportListResponseSchema", () => {
  it("parset een meta-rij", () => {
    expect(reportMetaSchema.safeParse(makeReportMeta()).success).toBe(true);
    expect(
      reportMetaSchema.safeParse(makeReportMeta({ format: "exe" as never }))
        .success,
    ).toBe(false);
  });

  it("parset de lijst-respons met next_cursor", () => {
    const parsed = reportListResponseSchema.safeParse({
      reports: [makeReportMeta(), makeReportMeta({ format: "pdf" })],
      next_cursor: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reports).toHaveLength(2);

    const withCursor = reportListResponseSchema.safeParse({
      reports: [makeReportMeta()],
      next_cursor: "abc",
    });
    expect(withCursor.success).toBe(true);
    if (withCursor.success) expect(withCursor.data.next_cursor).toBe("abc");

    // next_cursor is verplicht (wel nullable)
    expect(
      reportListResponseSchema.safeParse({ reports: [] }).success,
    ).toBe(false);
  });
});

describe("report cursors", () => {
  it("encode/decode is round-trip stable", () => {
    const cursor = encodeReportCursor(NOW, "00000000-0000-4000-8000-00000000000a");
    const decoded = decodeReportCursor(cursor);
    expect(decoded).toEqual({
      created_at: NOW,
      id: "00000000-0000-4000-8000-00000000000a",
    });
  });

  it("decodeReportCursor retourneert null voor ongeldig base64/json", () => {
    expect(decodeReportCursor("!!!geen-base64!!!")).toBeNull();
    expect(decodeReportCursor(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(
      decodeReportCursor(
        Buffer.from(JSON.stringify({ t: "x" })).toString("base64url"),
      ),
    ).toBeNull();
  });
});

describe("reportListQuerySchema", () => {
  it("accepteert lege query en een geldige site_id", () => {
    expect(reportListQuerySchema.safeParse({}).success).toBe(true);
    expect(
      reportListQuerySchema.safeParse({
        site_id: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(true);
  });

  it("accepteert cursor en limit (coerce)", () => {
    const parsed = reportListQuerySchema.safeParse({
      cursor: "eyJ0IjoiMSIsImkiOiIyIn0",
      limit: "50",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);
  });

  it("weigert limit buiten bereik", () => {
    expect(reportListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(reportListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("weigert een ongeldige site_id", () => {
    expect(reportListQuerySchema.safeParse({ site_id: "geen-uuid" }).success).toBe(
      false,
    );
  });
});